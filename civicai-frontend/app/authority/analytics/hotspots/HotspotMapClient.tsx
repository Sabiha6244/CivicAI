"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

export type HotspotPoint = {
  id: string;
  lat: number;
  lng: number;
  count: number;
  area: string;
  category: string;
  sampleTitle: string;
};

const mapWrapStyle: CSSProperties = {
  position: "relative",
  borderRadius: "24px",
  overflow: "hidden",
  border: "1px solid rgba(148, 163, 184, 0.14)",
  minHeight: "520px",
};

const legendStyle: CSSProperties = {
  position: "absolute",
  right: 16,
  bottom: 16,
  zIndex: 500,
  width: 240,
  background: "rgba(8, 15, 32, 0.86)",
  border: "1px solid rgba(148, 163, 184, 0.14)",
  borderRadius: 18,
  padding: "14px 14px 12px",
  color: "#dbe7ff",
  backdropFilter: "blur(8px)",
};

const titleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  marginBottom: 8,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 8,
  fontSize: 14,
  lineHeight: 1.35,
};

const swatch = (background: string): CSSProperties => ({
  width: 14,
  height: 14,
  borderRadius: 999,
  background,
  flexShrink: 0,
});

function HeatLayer({
  points,
  useMap,
}: {
  points: HotspotPoint[];
  useMap: any;
}) {
  const map = useMap();

  useEffect(() => {
    let layer: any = null;
    let cancelled = false;

    async function setupHeat() {
      const leafletImport: any = await import("leaflet");
      const leafletAny = leafletImport.default ?? leafletImport;

      (window as any).L = leafletAny;
      await import("leaflet.heat");

      if (cancelled) return;

      const LAny = (window as any).L;

      const payload: Array<[number, number, number]> = points.map((point) => [
        point.lat,
        point.lng,
        Math.min(1, 0.2 + point.count * 0.15),
      ]);

      layer = LAny.heatLayer(payload, {
        radius: 28,
        blur: 22,
        maxZoom: 17,
        minOpacity: 0.35,
        gradient: {
          0.15: "#3b82f6",
          0.35: "#22c55e",
          0.55: "#facc15",
          0.75: "#f97316",
          1.0: "#ef4444",
        },
      });

      layer.addTo(map);
    }

    setupHeat();

    return () => {
      cancelled = true;
      if (layer) {
        map.removeLayer(layer);
      }
    };
  }, [map, points]);

  return null;
}

function FitBounds({
  points,
  useMap,
}: {
  points: HotspotPoint[];
  useMap: any;
}) {
  const map = useMap();

  useEffect(() => {
    let cancelled = false;

    async function fit() {
      if (points.length === 0) return;

      const leafletImport: any = await import("leaflet");
      const leafletAny = (window as any).L || leafletImport.default || leafletImport;

      if (cancelled) return;

      const bounds = leafletAny.latLngBounds(
        points.map((point) => [point.lat, point.lng])
      );

      map.fitBounds(bounds.pad(0.22), { animate: false });
    }

    fit();

    return () => {
      cancelled = true;
    };
  }, [map, points]);

  return null;
}

export default function HotspotMapClient({ points }: { points: HotspotPoint[] }) {
  const [reactLeafletModule, setReactLeafletModule] = useState<any>(null);

  useEffect(() => {
    let active = true;

    async function loadModules() {
      await import("leaflet");
      const reactLeaflet = await import("react-leaflet");

      if (!active) return;
      setReactLeafletModule(reactLeaflet);
    }

    loadModules();

    return () => {
      active = false;
    };
  }, []);

  const center = useMemo<[number, number]>(() => {
    if (points.length === 0) return [23.8103, 90.4125];

    const avgLat =
      points.reduce((sum, point) => sum + point.lat, 0) / points.length;
    const avgLng =
      points.reduce((sum, point) => sum + point.lng, 0) / points.length;

    return [avgLat, avgLng];
  }, [points]);

  if (!reactLeafletModule) {
    return <div style={mapWrapStyle}>Loading map...</div>;
  }

  const {
    MapContainer,
    TileLayer,
    CircleMarker,
    Popup,
    Tooltip,
    useMap,
  } = reactLeafletModule;

  const showPermanentLabels = points.length <= 25;

  return (
    <div style={mapWrapStyle}>
      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom
        style={{ height: "520px", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <HeatLayer points={points} useMap={useMap} />
        <FitBounds points={points} useMap={useMap} />

        {points.map((point) => {
          const radius = Math.max(6, Math.min(18, 6 + point.count * 2));

          return (
            <CircleMarker
              key={point.id}
              center={[point.lat, point.lng]}
              radius={radius}
              pathOptions={{
                color: "#fff7cc",
                weight: 1.5,
                fillColor: "#ffd666",
                fillOpacity: 0.85,
              }}
            >
              {showPermanentLabels ? (
                <Tooltip permanent direction="top" offset={[0, -8]}>
                  <span>{point.area}</span>
                </Tooltip>
              ) : null}

              <Popup>
                <div style={{ minWidth: 180 }}>
                  <strong>{point.area}</strong>
                  <div style={{ marginTop: 6 }}>Complaints: {point.count}</div>
                  <div>Category: {point.category}</div>
                  <div>Sample: {point.sampleTitle}</div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      <div style={legendStyle}>
        <div style={titleStyle}>Map guide</div>
        <div style={rowStyle}>
          <span
            style={swatch("linear-gradient(135deg, #3b82f6 0%, #22c55e 100%)")}
          />
          Lower to medium complaint concentration
        </div>
        <div style={rowStyle}>
          <span
            style={swatch("linear-gradient(135deg, #facc15 0%, #f97316 100%)")}
          />
          Higher complaint concentration
        </div>
        <div style={rowStyle}>
          <span style={swatch("#ffd666")} />
          Grouped point with area label and popup
        </div>
      </div>
    </div>
  );
}
