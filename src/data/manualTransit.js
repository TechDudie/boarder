const pathStops = [
  ["newark", "Newark Penn Station", 40.7345, -74.1646],
  ["harrison", "Harrison", 40.7394, -74.1556],
  ["journal-square", "Journal Square", 40.7321, -74.0639],
  ["grove-st", "Grove Street", 40.7196, -74.0431],
  ["exchange-place", "Exchange Place", 40.7167, -74.0334],
  ["world-trade-center", "World Trade Center", 40.7126, -74.0099],
  ["newport", "Newport", 40.7269, -74.0343],
  ["hoboken", "Hoboken", 40.7359, -74.0292],
  ["christopher-st", "Christopher Street", 40.7334, -74.0075],
  ["9-st", "9th Street", 40.7342, -73.9986],
  ["14-st", "14th Street", 40.7382, -73.9981],
  ["23-st", "23rd Street", 40.7429, -73.9928],
  ["33-st", "33rd Street", 40.7491, -73.9881],
];

const downtownStops = [
  ["dc-battery", "Battery Place", 40.7049, -74.0176],
  ["dc-wtc", "World Trade Center", 40.7127, -74.0128],
  ["dc-city-hall", "City Hall", 40.7134, -74.0066],
  ["dc-seaport", "South Street Seaport", 40.7067, -74.0036],
  ["dc-wall", "Wall Street", 40.7061, -74.0092],
  ["dc-broadway", "Broadway / Bowling Green", 40.7044, -74.0137],
];

function stops(rows) {
  return rows.map(([id, name, lat, lng]) => ({ id, name, lat, lng }));
}

export default {
  metroNorth: {
    routes: [
      {
        id: "metro-north-gct-harlem-125",
        name: "Grand Central Terminal - Harlem-125th St",
        color: "#7c3aed",
        points: [
          [40.7527, -73.9772],
          [40.7582, -73.9689],
          [40.7646, -73.9576],
          [40.7712, -73.9467],
          [40.8052, -73.9392],
        ],
      },
    ],
    stops: [
      { id: "metro-north-gct", name: "Grand Central Terminal", lat: 40.7527, lng: -73.9772 },
      { id: "metro-north-harlem-125", name: "Harlem-125th St", lat: 40.8052, lng: -73.9392 },
    ],
  },
  path: {
    routes: [
      {
        id: "path-newark-wtc",
        name: "PATH Newark - World Trade Center",
        color: "#dc2626",
        points: pathStops.slice(0, 6).map(([, , lat, lng]) => [lat, lng]),
      },
      {
        id: "path-hoboken-33",
        name: "PATH Hoboken - 33rd Street",
        color: "#2563eb",
        points: pathStops.slice(7).map(([, , lat, lng]) => [lat, lng]),
      },
      {
        id: "path-journal-square-33",
        name: "PATH Journal Square - 33rd Street",
        color: "#f59e0b",
        points: [pathStops[2], pathStops[3], pathStops[6], ...pathStops.slice(8)].map(([, , lat, lng]) => [lat, lng]),
      },
      {
        id: "path-hoboken-wtc",
        name: "PATH Hoboken - World Trade Center",
        color: "#16a34a",
        points: [pathStops[7], pathStops[6], pathStops[4], pathStops[5]].map(([, , lat, lng]) => [lat, lng]),
      },
    ],
    stops: stops(pathStops),
  },
  downtownConnection: {
    routes: [
      {
        id: "downtown-connection-loop",
        name: "Downtown Connection Bus",
        color: "#dc2626",
        points: [...downtownStops, downtownStops[0]].map(([, , lat, lng]) => [lat, lng]),
      },
    ],
    stops: stops(downtownStops),
  },
};
