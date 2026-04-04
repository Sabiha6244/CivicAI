import divisionsRaw from "./data/bd-divisions.json";
import districtsRaw from "./data/bd-districts.json";
import upazilasRaw from "./data/bd-upazilas.json";
import dhakaCityRaw from "./data/dhaka-city.json";
import postcodesRaw from "./data/bd-postcodes.json";
import upazilaCentersRaw from "./data/upazila-centers.json";
import dhakaAreaCentersRaw from "./data/dhaka-area-centers.json";

export type DivisionItem = {
  id: string;
  name: string;
  bn_name?: string;
  lat?: string;
  long?: string;
};

export type DistrictItem = {
  id: string;
  division_id: string;
  name: string;
  bn_name?: string;
  lat?: string;
  long?: string;
};

export type UpazilaItem = {
  id: string;
  district_id: string;
  name: string;
  bn_name?: string;
  lat?: string;
  long?: string;
};

export type DhakaCityItem = {
  division_id: string;
  district_id: string;
  city_corporation: string;
  name: string;
  bn_name?: string;
  lat?: string;
  long?: string;
};

export type PostcodeItem = {
  division_id: string;
  district_id: string;
  upazila: string;
  postOffice: string;
  postCode: string;
};

export type UpazilaCenterItem = {
  id: string;
  district_id: string;
  name: string;
  bn_name?: string;
  lat: number;
  lng: number;
  zoom?: number;
  match_status?: string;
  matched_adm3_name?: string | null;
  matched_adm3_pcode?: string | null;
  note?: string | null;
};

export type DhakaAreaCenterItem = {
  id: string;
  division_id: string;
  district_id: string;
  city_corporation: string;
  name: string;
  bn_name?: string;
  lat: number;
  lng: number;
  zoom?: number;
  match_status?: string;
  matched_name?: string | null;
};

type DivisionsFile = {
  divisions: DivisionItem[];
};

type DistrictsFile = {
  districts: DistrictItem[];
};

type UpazilasFile = {
  upazilas: UpazilaItem[];
};

type DhakaCityFile = {
  dhaka: DhakaCityItem[];
};

type PostcodesFile = {
  postcodes: PostcodeItem[];
};

type UpazilaCentersFile = {
  upazila_centers: UpazilaCenterItem[];
  summary?: {
    total_input_upazilas?: number;
    exact_or_alias_match?: number;
    fuzzy_match?: number;
    district_fallback?: number;
  };
};

type DhakaAreaCentersFile = {
  dhaka_area_centers: DhakaAreaCenterItem[];
  summary?: {
    adm3_exact?: number;
    adm3_alias?: number;
    adm4_alias?: number;
    district_fallback?: number;
  };
};

export const divisions = (divisionsRaw as DivisionsFile).divisions ?? [];
export const districts = (districtsRaw as DistrictsFile).districts ?? [];
export const upazilas = (upazilasRaw as UpazilasFile).upazilas ?? [];
export const dhakaCityAreas = (dhakaCityRaw as DhakaCityFile).dhaka ?? [];
export const postcodes = (postcodesRaw as PostcodesFile).postcodes ?? [];
export const upazilaCenters =
  (upazilaCentersRaw as UpazilaCentersFile).upazila_centers ?? [];
export const dhakaAreaCenters =
  (dhakaAreaCentersRaw as DhakaAreaCentersFile).dhaka_area_centers ?? [];

export function parseCoordinate(value?: string | number | null): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getDivisionByName(name: string) {
  return divisions.find((item) => item.name === name) ?? null;
}

export function getDistrictByName(name: string) {
  return districts.find((item) => item.name === name) ?? null;
}

export function getUpazilaCenterByName(name: string, districtId?: string | null) {
  if (!name) return null;

  const normalizedName = name.trim().toLowerCase();

  if (districtId) {
    const exactWithinDistrict =
      upazilaCenters.find(
        (item) =>
          item.district_id === districtId &&
          item.name.trim().toLowerCase() === normalizedName
      ) ?? null;

    if (exactWithinDistrict) return exactWithinDistrict;
  }

  return (
    upazilaCenters.find(
      (item) => item.name.trim().toLowerCase() === normalizedName
    ) ?? null
  );
}

export function getDhakaAreaCenterByName(name: string, districtId?: string | null) {
  if (!name) return null;

  const normalizedName = name.trim().toLowerCase();

  if (districtId) {
    const exactWithinDistrict =
      dhakaAreaCenters.find(
        (item) =>
          item.district_id === districtId &&
          item.name.trim().toLowerCase() === normalizedName
      ) ?? null;

    if (exactWithinDistrict) return exactWithinDistrict;
  }

  return (
    dhakaAreaCenters.find(
      (item) => item.name.trim().toLowerCase() === normalizedName
    ) ?? null
  );
}