import divisionsRaw from "./data/bd-divisions.json";
import districtsRaw from "./data/bd-districts.json";
import upazilasRaw from "./data/bd-upazilas.json";
import dhakaCityRaw from "./data/dhaka-city.json";
import postcodesRaw from "./data/bd-postcodes.json";

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

export const divisions = (divisionsRaw as DivisionsFile).divisions ?? [];
export const districts = (districtsRaw as DistrictsFile).districts ?? [];
export const upazilas = (upazilasRaw as UpazilasFile).upazilas ?? [];
export const dhakaCityAreas = (dhakaCityRaw as DhakaCityFile).dhaka ?? [];
export const postcodes = (postcodesRaw as PostcodesFile).postcodes ?? [];

export function parseCoordinate(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}