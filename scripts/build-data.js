import { mkdir, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import Papa from "papaparse";
import manualTransit from "../src/data/manualTransit.js";

const feeds = [
  { id: "subway", url: "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_supplemented.zip" },
  { id: "metroNorth", url: "http://web.mta.info/developers/data/mnr/google_transit.zip" },
  { id: "bus", url: "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_bx.zip" },
  { id: "bus", url: "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_b.zip" },
  { id: "bus", url: "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_m.zip" },
  { id: "bus", url: "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_q.zip" },
  { id: "bus", url: "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_si.zip" },
  { id: "bus", url: "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_busco.zip" },
  { id: "ferry", url: "https://nycferry.connexionz.net/rtt/public/utility/gtfs.aspx" },
];

const layers = {
  subway: { name: "MTA Subway", color: "#111827", weight: 4, routes: [], stops: [] },
  path: { name: "PATH", color: "#0f766e", weight: 4, routes: manualTransit.path.routes, stops: manualTransit.path.stops },
  metroNorth: { name: "Metro-North", color: "#7c3aed", weight: 4, routes: [], stops: [] },
  bus: { name: "MTA Regional Bus Operations", color: "#2563eb", weight: 2, opacity: 0.45, routes: [], stops: [] },
  downtownConnection: {
    name: "Downtown Connection Bus",
    color: "#dc2626",
    weight: 4,
    routes: [],
    stops: [],
  },
  ferry: { name: "NYC Ferry", color: "#0891b2", weight: 3, routes: [], stops: [] },
};

const manhattanBounds = {
  minLat: 40.68,
  maxLat: 40.83,
  minLng: -74.04,
  maxLng: -73.92,
};

function parseCsv(text) {
  return Papa.parse(text.trim(), { header: true, skipEmptyLines: true }).data;
}

async function readZipTable(zip, name) {
  const file = zip.file(name);
  if (!file) return [];
  return parseCsv(await file.async("string"));
}

function normalizeColor(color, fallback) {
  if (!color) return fallback;
  return color.startsWith("#") ? color : `#${color}`;
}

function routeName(route) {
  return route.route_short_name || route.route_long_name || route.route_id;
}

function pickLongestShapes(shapes) {
  const byShape = new Map();

  for (const point of shapes) {
    if (!point.shape_id) continue;
    if (!byShape.has(point.shape_id)) byShape.set(point.shape_id, []);
    byShape.get(point.shape_id).push(point);
  }

  return [...byShape.entries()].map(([shapeId, points]) => {
    const sorted = points
      .sort((a, b) => Number(a.shape_pt_sequence) - Number(b.shape_pt_sequence))
      .map((point) => [Number(point.shape_pt_lat), Number(point.shape_pt_lon)])
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

    return { shapeId, points: sorted, length: sorted.length };
  });
}

function compactPoints(points, feedId) {
  const maxPoints = feedId === "bus" ? 160 : 1200;
  if (points.length <= maxPoints) return points;

  const step = Math.ceil(points.length / (maxPoints - 1));
  const compacted = points.filter((_, index) => index % step === 0);
  const last = points[points.length - 1];

  if (compacted[compacted.length - 1] !== last) compacted.push(last);
  return compacted;
}

function pointInBounds([lat, lng]) {
  return (
    lat >= manhattanBounds.minLat &&
    lat <= manhattanBounds.maxLat &&
    lng >= manhattanBounds.minLng &&
    lng <= manhattanBounds.maxLng
  );
}

function stopInBounds(stop) {
  return pointInBounds([stop.lat, stop.lng]);
}

function filterToManhattan(data) {
  return {
    routes: data.routes.filter((route) => route.points.some(pointInBounds)),
    stops: data.stops.filter(stopInBounds),
  };
}

function buildShapeRoutes(feedId, routes, trips, shapes) {
  const shapesById = new Map(pickLongestShapes(shapes).map((shape) => [shape.shapeId, shape]));
  const routeShapes = new Map();

  for (const trip of trips) {
    if (!trip.route_id || !trip.shape_id || !shapesById.has(trip.shape_id)) continue;
    const key = `${trip.route_id}:${trip.direction_id || "0"}`;
    const candidate = shapesById.get(trip.shape_id);
    const current = routeShapes.get(key);
    if (!current || candidate.length > current.shape.length) {
      routeShapes.set(key, { routeId: trip.route_id, directionId: trip.direction_id || "0", shape: candidate });
    }
  }

  const routeById = new Map(routes.map((route) => [route.route_id, route]));

  return [...routeShapes.values()].map(({ routeId, directionId, shape }) => {
    const route = routeById.get(routeId) || { route_id: routeId };
    return {
      id: `${feedId}-${routeId}-${directionId}`,
      name: routeName(route),
      color: normalizeColor(route.route_color, layers[feedId].color),
      points: compactPoints(shape.points, feedId),
    };
  });
}

function buildStops(feedId, stops, stopTimes, trips, routeIds) {
  const routeTripIds = new Set(trips.filter((trip) => routeIds.has(trip.route_id)).map((trip) => trip.trip_id));
  const stopIds = new Set(stopTimes.filter((time) => routeTripIds.has(time.trip_id)).map((time) => time.stop_id));

  return stops
    .filter((stop) => stopIds.has(stop.stop_id))
    .map((stop) => ({
      id: `${feedId}-${stop.stop_id}`,
      name: stop.stop_name,
      lat: Number(stop.stop_lat),
      lng: Number(stop.stop_lon),
    }))
    .filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lng));
}

function filterMetroNorth(routes, stops) {
  const wanted = /^(Grand Central|Grand Central Terminal|Harlem-125)/i;
  const stationStops = stops.filter((stop) => wanted.test(stop.name));
  const byName = new Map(stationStops.map((stop) => [stop.name.toLowerCase(), stop]));
  const grandCentral = stationStops.find((stop) => stop.name.toLowerCase().includes("grand central"));
  const harlem125 = stationStops.find((stop) => stop.name.toLowerCase().includes("harlem-125"));

  return {
    routes: manualTransit.metroNorth.routes,
    stops: [
      grandCentral || byName.get("grand central terminal") || manualTransit.metroNorth.stops[0],
      harlem125 || manualTransit.metroNorth.stops[1],
    ],
  };
}

async function fetchZip(url) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return JSZip.loadAsync(await response.arrayBuffer());
}

async function buildDowntownConnection() {
  const url =
    "https://passiogo.com/mapGetData.php?getStops=2&deviceId=0&withOutdated=1&wBounds=1&buildNo=0&showBusInOos=0";
  console.log(`Downloading ${url}`);
  const body = new URLSearchParams({ json: JSON.stringify({ s0: 7073, sA: 1 }) });
  const response = await fetch(url, { method: "POST", body });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);

  const data = await response.json();
  const routeId = Object.keys(data.routes || {})[0];
  const route = data.routes?.[routeId] || {};
  const segments = data.routePoints?.[routeId] || [];
  const points = segments
    .flat()
    .map((point) => [Number(point.lat), Number(point.lng)])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  const stops = Object.values(data.stops || {})
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((stop) => ({
      id: `downtown-${stop.stopId || stop.id}`,
      name: stop.name,
      lat: Number(stop.latitude),
      lng: Number(stop.longitude),
    }))
    .filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lng));

  if (!points.length || !stops.length) throw new Error("Downtown Connection feed had no route geometry");

  return {
    routes: [
      {
        id: "downtown-connection-loop",
        name: route.name || "Free Downtown Connection",
        color: "#dc2626",
        points: compactPoints(points, "downtownConnection"),
      },
    ],
    stops,
  };
}

async function buildFeed(feed) {
  const zip = await fetchZip(feed.url);
  const routes = await readZipTable(zip, "routes.txt");
  const trips = await readZipTable(zip, "trips.txt");
  const shapes = await readZipTable(zip, "shapes.txt");
  const stops = await readZipTable(zip, "stops.txt");
  const stopTimes = await readZipTable(zip, "stop_times.txt");

  if (feed.id === "metroNorth") {
    const routeIds = new Set(routes.map((route) => route.route_id));
    return filterMetroNorth(
      buildShapeRoutes(feed.id, routes, trips, shapes),
      buildStops(feed.id, stops, stopTimes, trips, routeIds),
    );
  }

  const routeIds = new Set(routes.map((route) => route.route_id));
  const data = {
    routes: buildShapeRoutes(feed.id, routes, trips, shapes),
    stops: buildStops(feed.id, stops, stopTimes, trips, routeIds),
  };

  return feed.id === "bus" ? filterToManhattan(data) : data;
}

async function buildZones() {
  const html = await readFile("map", "utf8");
  const match = html.match(/var zones\s*=\s*(\[.*?\]);\s*var teams/s);
  if (!match) throw new Error("Could not find the zones array in map");
  return JSON.parse(match[1]);
}

async function main() {
  await mkdir("public/data", { recursive: true });
  await writeFile("public/data/zones.json", `${JSON.stringify(await buildZones())}\n`);

  for (const feed of feeds) {
    try {
      const data = await buildFeed(feed);
      layers[feed.id].routes.push(...data.routes);
      layers[feed.id].stops.push(...data.stops);
    } catch (error) {
      console.warn(`Skipped ${feed.url}`);
      console.warn(error.message);
    }
  }

  if (layers.metroNorth.routes.length === 0) {
    layers.metroNorth.routes = manualTransit.metroNorth.routes;
    layers.metroNorth.stops = manualTransit.metroNorth.stops;
  }

  try {
    const downtownConnection = await buildDowntownConnection();
    layers.downtownConnection.routes = downtownConnection.routes;
    layers.downtownConnection.stops = downtownConnection.stops;
  } catch (error) {
    console.warn("Skipped live Downtown Connection feed");
    console.warn(error.message);
    layers.downtownConnection.routes = manualTransit.downtownConnection.routes;
    layers.downtownConnection.stops = manualTransit.downtownConnection.stops;
  }

  for (const [id, layer] of Object.entries(layers)) {
    await writeFile(`public/data/${id}.json`, `${JSON.stringify(layer)}\n`);
  }

  await writeFile("public/data/transit.json", `${JSON.stringify(layers)}\n`);
  console.log("Wrote public/data/zones.json, public/data/transit.json, and per-layer files");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
