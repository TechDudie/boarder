import L from "leaflet";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { teams, zoneTeamIds } from "./data/teamAssignments";

const center = [40.7549, -73.984];

const layerNames = {
  subway: "MTA Subway",
  path: "PATH",
  metroNorth: "Metro-North: GCT / Harlem-125th",
  bus: "MTA Regional Bus Operations",
  downtownConnection: "Downtown Connection Bus",
  ferry: "NYC Ferry",
};

const defaultActiveLayers = {
  subway: true,
  path: false,
  metroNorth: false,
  bus: true,
  downtownConnection: true,
  ferry: true,
};

const defaultActiveTeams = Object.fromEntries(Object.keys(teams).map((id) => [id, true]));
const fallbackTeam = {
  id: "unassigned",
  label: "Unassigned",
  color: "#374151",
  fillColor: "#9ca3af",
  transit: "",
};

function zoneEdgeRing(positions) {
  const ring = [];

  for (const position of positions) {
    const point = [Number(position[0]), Number(position[1])];
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    if (
      ring.length &&
      ring[ring.length - 1][0] === point[0] &&
      ring[ring.length - 1][1] === point[1]
    ) {
      continue;
    }
    ring.push(point);
  }

  if (
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  ) {
    ring.pop();
  }

  if (ring.length < 3) return [];
  return [...ring, ring[0]];
}

function setMapCursor(event, cursor) {
  const container = event.target._map?.getContainer();
  if (container) container.style.cursor = cursor;
}

function MapSelectionEvents({ onClearSelection }) {
  useMapEvents({
    click: onClearSelection,
  });

  return null;
}

function StopDotsLayer({ color, stops }) {
  const map = useMap();

  useEffect(() => {
    if (!stops.length) return;

    const canvas = L.DomUtil.create("canvas", "stop-dots-layer");
    const context = canvas.getContext("2d");
    const pane = map.getPane("overlayPane");

    pane.appendChild(canvas);

    function resize() {
      const size = map.getSize();
      const topLeft = map.containerPointToLayerPoint([0, 0]);

      canvas.width = size.x;
      canvas.height = size.y;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      L.DomUtil.setPosition(canvas, topLeft);
    }

    function draw() {
      resize();
      context.clearRect(0, 0, canvas.width, canvas.height);

      const radius = map.getZoom() >= 14 ? 4 : 3;
      const bounds = map.getBounds().pad(0.15);

      for (const stop of stops) {
        const latLng = L.latLng(stop.lat, stop.lng);
        if (!bounds.contains(latLng)) continue;

        const point = map.latLngToContainerPoint(latLng);
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
        context.lineWidth = 1.5;
        context.strokeStyle = "#fff";
        context.stroke();
      }
    }

    draw();
    map.on("moveend zoomend resize", draw);

    return () => {
      map.off("moveend zoomend resize", draw);
      canvas.remove();
    };
  }, [color, map, stops]);

  return null;
}

function TransitLayer({ id, data }) {
  return (
    <>
      {data.routes.map((route) => (
        <Polyline
          key={`${id}-route-${route.id}`}
          bubblingMouseEvents={false}
          positions={route.points}
          pathOptions={{
            color: route.color || data.color,
            weight: data.weight || 3,
            opacity: data.opacity || 0.75,
          }}
        >
          <Popup>{route.name}</Popup>
        </Polyline>
      ))}

      <StopDotsLayer color={data.color} stops={data.stops} />
    </>
  );
}

export default function App() {
  const [zones, setZones] = useState([]);
  const [activeLayers, setActiveLayers] = useState(defaultActiveLayers);
  const [activeTeams, setActiveTeams] = useState(defaultActiveTeams);
  const [layerData, setLayerData] = useState({});
  const [selectedZoneKeys, setSelectedZoneKeys] = useState([]);
  const loadingLayers = useRef(new Set());
  const selectionRenderer = useMemo(() => L.svg({ padding: 0.5 }), []);

  useEffect(() => {
    fetch("/data/zones.json")
      .then((response) => response.json())
      .then((zoneData) =>
        setZones(
          zoneData.map((zone, index) => ({
            ...zone,
            zoneKey: `${zone.id || "zone"}-${index}`,
            teamId: zoneTeamIds[index] || fallbackTeam.id,
            positions: zone.coordinates?.map((point) => [point.lat, point.lng]) || [],
          })),
        ),
      );
  }, []);

  useEffect(() => {
    Object.entries(activeLayers).forEach(([id, enabled]) => {
      if (!enabled || layerData[id] || loadingLayers.current.has(id)) return;

      loadingLayers.current.add(id);
      fetch(`/data/${id}.json`)
        .then((response) => response.json())
        .then((data) => setLayerData((current) => ({ ...current, [id]: data })));
    });
  }, [activeLayers, layerData]);

  const visibleZoneKeySet = useMemo(
    () =>
      new Set(
        zones
          .filter((zone) => zone.positions.length > 1)
          .filter((zone) => activeTeams[(teams[zone.teamId] || fallbackTeam).id])
          .map((zone) => zone.zoneKey),
      ),
    [activeTeams, zones],
  );

  useEffect(() => {
    setSelectedZoneKeys((current) => {
      const visibleSelection = current.filter((zoneKey) => visibleZoneKeySet.has(zoneKey));
      return visibleSelection.length === current.length ? current : visibleSelection;
    });
  }, [visibleZoneKeySet]);

  const selectedZoneKeySet = useMemo(() => new Set(selectedZoneKeys), [selectedZoneKeys]);

  const selectedZones = useMemo(
    () =>
      zones.filter(
        (zone) =>
          selectedZoneKeySet.has(zone.zoneKey) &&
          zone.positions.length > 1 &&
          activeTeams[(teams[zone.teamId] || fallbackTeam).id],
      ),
    [activeTeams, selectedZoneKeySet, zones],
  );

  const selectedZoneEdgeRings = useMemo(() => {
    if (!selectedZones.length) return [];
    return selectedZones
      .map((zone) => ({ key: zone.zoneKey, ring: zoneEdgeRing(zone.positions) }))
      .filter(({ ring }) => ring.length > 3);
  }, [selectedZones]);

  const selectedZoneSummary = useMemo(() => {
    if (!selectedZones.length) {
      return { label: "No zones selected", detail: "" };
    }

    if (selectedZones.length === 1) {
      const [zone] = selectedZones;
      return { label: zone.name, detail: `Zone ${zone.id}` };
    }

    const names = selectedZones.map((zone) => zone.name);
    const visibleNames = names.slice(0, 3).join(", ");
    const remainingCount = names.length - 3;

    return {
      label: `${selectedZones.length} zones selected`,
      detail: remainingCount > 0 ? `${visibleNames}, +${remainingCount} more` : visibleNames,
    };
  }, [selectedZones]);

  const zoneCount = useMemo(
    () => zones.filter((zone) => zone.positions.length > 1).length,
    [zones],
  );

  const teamCounts = useMemo(
    () =>
      zones.reduce((counts, zone) => {
        if (zone.positions.length < 2) return counts;
        counts[zone.teamId] = (counts[zone.teamId] || 0) + 1;
        return counts;
      }, {}),
    [zones],
  );
  const activeLayerCount = useMemo(
    () => Object.values(activeLayers).filter(Boolean).length,
    [activeLayers],
  );

  function toggleLayer(id) {
    setActiveLayers((current) => ({ ...current, [id]: !current[id] }));
  }

  function toggleTeam(id) {
    setActiveTeams((current) => ({ ...current, [id]: !current[id] }));
  }

  function handleZoneClick(event, zoneKey) {
    if (event.originalEvent.shiftKey) {
      setSelectedZoneKeys((current) =>
        current.includes(zoneKey)
          ? current.filter((selectedZoneKey) => selectedZoneKey !== zoneKey)
          : [...current, zoneKey],
      );
      return;
    }

    setSelectedZoneKeys([zoneKey]);
  }

  function clearSelection() {
    setSelectedZoneKeys([]);
  }

  return (
    <div className="app">
      <MapContainer center={center} zoom={12} minZoom={10} className="map" preferCanvas>
        <MapSelectionEvents onClearSelection={clearSelection} />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          referrerPolicy="origin"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {zones.map((zone, index) => {
          if (zone.positions.length < 2) return null;
          const team = teams[zone.teamId] || fallbackTeam;
          if (!activeTeams[team.id]) return null;
          const isSelected = selectedZoneKeySet.has(zone.zoneKey);

          return (
            <Polygon
              key={`${zone.id}-${index}`}
              bubblingMouseEvents={false}
              eventHandlers={{
                click: (event) => handleZoneClick(event, zone.zoneKey),
                mouseout: (event) => setMapCursor(event, ""),
                mouseover: (event) => setMapCursor(event, "pointer"),
              }}
              positions={zone.positions}
              pathOptions={{
                color: isSelected ? "#111827" : team.color,
                fillColor: team.fillColor,
                fillOpacity: isSelected ? 0.42 : 0.22,
                opacity: isSelected ? 1 : 0.9,
                weight: isSelected ? 3.5 : 2.5,
              }}
            >
              <Popup>
                <div className="popup-title">{zone.name}</div>
                <div>Zone {zone.id}</div>
                <div>Entry {index}</div>
                <div>{team.label}</div>
                {team.transit ? <div>{team.transit}</div> : null}
              </Popup>
            </Polygon>
          );
        })}

        {Object.entries(activeLayers).map(([id, enabled]) => {
          const data = layerData[id];
          if (!enabled || !data) return null;
          return <TransitLayer id={id} key={id} data={data} />;
        })}

        {selectedZoneEdgeRings.map(({ key, ring }) => (
          <React.Fragment key={`selected-edge-${key}`}>
            <Polyline
              interactive={false}
              positions={ring}
              pathOptions={{
                renderer: selectionRenderer,
                className: "selection-outline-halo",
                color: "#ffffff",
                lineCap: "round",
                lineJoin: "round",
                opacity: 0.95,
                weight: 9,
              }}
            />
            <Polyline
              interactive={false}
              positions={ring}
              pathOptions={{
                renderer: selectionRenderer,
                className: "selection-outline-snake",
                color: "#111827",
                dashArray: "14 10",
                lineCap: "round",
                lineJoin: "round",
                opacity: 1,
                weight: 4,
              }}
            />
          </React.Fragment>
        ))}
      </MapContainer>

      <details className="panel" open>
        <summary className="panel-summary">
          <span className="panel-summary-title">HCTG Map ({zoneCount}) - Yellow 3 Will Win!</span>
          <span className="panel-summary-meta">
            {selectedZones.length} selected / {activeLayerCount} transit on
          </span>
        </summary>

        <div className="panel-content">
          <div className="panel-heading">Selection</div>
          <div className="panel-row selection-row">
            <div className="selection-copy">
              <div className={selectedZones.length ? "selection-label" : "selection-label muted"}>
                {selectedZoneSummary.label}
              </div>
              {selectedZoneSummary.detail ? (
                <div className="selection-detail">{selectedZoneSummary.detail}</div>
              ) : null}
            </div>
            {selectedZones.length ? (
              <button
                aria-label="Clear selected zones"
                className="clear-selection"
                onClick={clearSelection}
                type="button"
              >
                Clear
              </button>
            ) : null}
          </div>

          <div className="panel-heading">Regions</div>
          {Object.values(teams).map((team) => (
            <label className="panel-row team-row" key={team.id}>
              <input checked={activeTeams[team.id]} onChange={() => toggleTeam(team.id)} type="checkbox" />
              <span className="swatch" style={{ background: team.fillColor, borderColor: team.color }} />
              <span className="team-label">{team.label}</span>
              <span className="count">{teamCounts[team.id] || 0}</span>
            </label>
          ))}

          <div className="panel-heading divider">Transit layers</div>
          {Object.keys(defaultActiveLayers).map((id) => (
            <label className="panel-row transit-row" key={id}>
              <input checked={activeLayers[id]} onChange={() => toggleLayer(id)} type="checkbox" />
              <span className="team-label">{layerNames[id]}</span>
              {activeLayers[id] && !layerData[id] ? <span className="loading-label">Loading</span> : null}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
