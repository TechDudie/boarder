import L from "leaflet";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  useMap,
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
  const loadingLayers = useRef(new Set());

  useEffect(() => {
    fetch("/data/zones.json")
      .then((response) => response.json())
      .then((zoneData) =>
        setZones(
          zoneData.map((zone, index) => ({
            ...zone,
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

  function toggleLayer(id) {
    setActiveLayers((current) => ({ ...current, [id]: !current[id] }));
  }

  function toggleTeam(id) {
    setActiveTeams((current) => ({ ...current, [id]: !current[id] }));
  }

  return (
    <div className="app">
      <MapContainer center={center} zoom={12} minZoom={10} className="map" preferCanvas>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {zones.map((zone, index) => {
          if (zone.positions.length < 2) return null;
          const team = teams[zone.teamId] || fallbackTeam;
          if (!activeTeams[team.id]) return null;

          return (
            <Polygon
              key={`${zone.id}-${index}`}
              positions={zone.positions}
              pathOptions={{
                color: team.color,
                fillColor: team.fillColor,
                fillOpacity: 0.22,
                weight: 2.5,
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
      </MapContainer>

      <div className="panel">
        <div className="panel-title">Scavenger Map</div>
        <div className="panel-row muted">Zones ({zoneCount})</div>

        <div className="panel-heading">Team zones</div>
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
          <label className="panel-row" key={id}>
            <input checked={activeLayers[id]} onChange={() => toggleLayer(id)} type="checkbox" />
            {layerNames[id]}
            {activeLayers[id] && !layerData[id] ? " loading" : ""}
          </label>
        ))}
        <div className="panel-row divider muted">Downtown Connection starts at 10 AM.</div>
      </div>
    </div>
  );
}
