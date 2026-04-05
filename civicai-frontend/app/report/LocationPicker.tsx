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
import styles from "./report.module.css";

type LocationPickerProps = {
  lat: number | null;
  lng: number | null;
  areaCenter?: {
    lat: number;
    lng: number;
    zoom?: number;
  } | null;
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

function SelectedPointMover({
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

function AreaCenterMover({
  areaCenter,
  lat,
  lng,
}: {
  areaCenter?: { lat: number; lng: number; zoom?: number } | null;
  lat: number | null;
  lng: number | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (lat === null && lng === null && areaCenter) {
      map.flyTo([areaCenter.lat, areaCenter.lng], areaCenter.zoom ?? 11, {
        duration: 0.8,
      });
    }
  }, [areaCenter, lat, lng, map]);

  return null;
}

export default function LocationPicker({
  lat,
  lng,
  areaCenter,
  onChange,
}: LocationPickerProps) {
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<"current" | "manual" | null>(null);

  const defaultCenter = useMemo<LatLngTuple>(() => {
    if (lat !== null && lng !== null) return [lat, lng];
    if (areaCenter) return [areaCenter.lat, areaCenter.lng];
    return [23.685, 90.3563];
  }, [lat, lng, areaCenter]);

  const defaultZoom = useMemo(() => {
    if (lat !== null && lng !== null) return 16;
    if (areaCenter?.zoom) return areaCenter.zoom;
    return 7;
  }, [lat, lng, areaCenter]);

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
      ? "After selecting division and district, the map will move to that area. Then click the exact complaint location on the map."
      : selectionMode === "current"
      ? "If the problem is somewhere else, choose 'Mark another location on map' and click the correct place."
      : "If this is not the correct place, click another point on the map.";

  const markerPosition: LatLngTuple | null =
    lat !== null && lng !== null ? [lat, lng] : null;

  return (
    <div className={styles.locationPicker}>
      <div className={styles.locationActionRow}>
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={locating}
          className={styles.locationActionButton}
        >
          {locating ? "Getting current location..." : "Use my current location"}
        </button>

        <button
          type="button"
          onClick={startManualSelection}
          className={styles.locationActionButton}
        >
          Mark another location on map
        </button>
      </div>

      <div className={styles.locationStatusBox}>
        <div className={styles.locationStatusTitle}>{locationStatus}</div>
        <div className={styles.locationStatusText}>{locationHelp}</div>
      </div>

      <MapContainer
        center={defaultCenter}
        zoom={defaultZoom}
        scrollWheelZoom={true}
        className={styles.locationMapFrame}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onSelectManualLocation={handleManualSelection} />
        <AreaCenterMover areaCenter={areaCenter} lat={lat} lng={lng} />
        <SelectedPointMover lat={lat} lng={lng} />
        {markerPosition ? <Marker position={markerPosition} icon={markerIcon} /> : null}
      </MapContainer>

      {locationError ? (
        <div className={styles.locationError}>{locationError}</div>
      ) : null}
    </div>
  );
}