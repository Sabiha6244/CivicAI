"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { icon, type LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";

type LocationPickerProps = {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
};

const markerIcon = icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41] as [number, number],
  iconAnchor: [12, 41] as [number, number],
});

function ClickHandler({
  onSelectManualLocation,
}: {
  onSelectManualLocation: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onSelectManualLocation(e.latlng.lat, e.latlng.lng);
    },
  });

  return null;
}

function MapMover({
  lat,
  lng,
}: {
  lat: number | null;
  lng: number | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (lat !== null && lng !== null) {
      const target: LatLngTuple = [lat, lng];
      map.flyTo(target, 16, { duration: 0.8 });
    }
  }, [lat, lng, map]);

  return null;
}

export default function LocationPicker({
  lat,
  lng,
  onChange,
}: LocationPickerProps) {
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<"current" | "manual" | null>(null);

  const defaultCenter = useMemo<LatLngTuple>(() => {
    if (lat !== null && lng !== null) return [lat, lng];
    return [23.685, 90.3563];
  }, [lat, lng]);

  function handleManualSelection(newLat: number, newLng: number) {
    setLocationError(null);
    setSelectionMode("manual");
    onChange(newLat, newLng);
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationError("Your browser does not support location access.");
      return;
    }

    setLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setSelectionMode("current");
        onChange(position.coords.latitude, position.coords.longitude);
        setLocating(false);
      },
      (error) => {
        setLocating(false);

        if (error.code === error.PERMISSION_DENIED) {
          setLocationError("Location access was denied. Please allow location permission.");
          return;
        }

        if (error.code === error.POSITION_UNAVAILABLE) {
          setLocationError("Your current location could not be determined.");
          return;
        }

        if (error.code === error.TIMEOUT) {
          setLocationError("Location request timed out. Please try again.");
          return;
        }

        setLocationError("Unable to get your current location.");
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  }

  function startManualSelection() {
    setSelectionMode("manual");
    setLocationError(null);
  }

  const locationStatus =
    lat === null || lng === null
      ? "No location selected yet."
      : selectionMode === "current"
      ? "Current location selected."
      : "Problem location selected on map.";

  const locationHelp =
    lat === null || lng === null
      ? "Choose your current location or click on the map to mark where the problem is."
      : selectionMode === "current"
      ? "If the problem is somewhere else, choose 'Mark another location on map' and click the correct place."
      : "If this is not the correct place, click another point on the map.";

  const markerPosition: LatLngTuple | null =
    lat !== null && lng !== null ? [lat, lng] : null;

  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={locating}
          style={{
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid #cbd5e1",
            background: "#ffffff",
            color: "#0f172a",
            fontSize: "0.92rem",
            fontWeight: 700,
            cursor: locating ? "not-allowed" : "pointer",
          }}
        >
          {locating ? "Getting current location..." : "Use my current location"}
        </button>

        <button
          type="button"
          onClick={startManualSelection}
          style={{
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid #cbd5e1",
            background: "#ffffff",
            color: "#0f172a",
            fontSize: "0.92rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Mark another location on map
        </button>
      </div>

      <div
        style={{
          marginBottom: 10,
          padding: "10px 12px",
          borderRadius: "10px",
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
        }}
      >
        <div
          style={{
            fontSize: "0.88rem",
            fontWeight: 700,
            color: "#0f766e",
          }}
        >
          {locationStatus}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: "0.84rem",
            color: "#64748b",
            lineHeight: 1.5,
          }}
        >
          {locationHelp}
        </div>
      </div>

      <MapContainer
        center={defaultCenter}
        zoom={lat !== null && lng !== null ? 16 : 7}
        scrollWheelZoom={true}
        style={{
          height: "360px",
          width: "100%",
          borderRadius: "14px",
          overflow: "hidden",
          border: "1px solid #cbd5e1",
        }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onSelectManualLocation={handleManualSelection} />
        <MapMover lat={lat} lng={lng} />
        {markerPosition ? <Marker position={markerPosition} icon={markerIcon} /> : null}
      </MapContainer>

      {locationError ? (
        <div
          style={{
            marginTop: 10,
            fontSize: "0.84rem",
            color: "#b91c1c",
          }}
        >
          {locationError}
        </div>
      ) : null}
    </div>
  );
}