import divisionsRaw from "./data/bd-divisions.json";
import districtsRaw from "./data/bd-districts.json";
import upazilasRaw from "./data/bd-upazilas.json";
import unionsRaw from "./data/unions.json";

export type DivisionItem = {
  id: string;
  name: string;
  bn_name?: string;
};

export type DistrictItem = {
  id: string;
  division_id: string;
  name: string;
  bn_name?: string;
};

export type UpazilaItem = {
  id: string;
  district_id: string;
  name: string;
  bn_name?: string;
};

export type UnionItem = {
  id: string;
  upazilla_id: string;
  name: string;
  bn_name?: string;
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

type UnionsFile = Array<
  | { type: string }
  | {
      type: "table";
      name: string;
      database: string;
      data: UnionItem[];
    }
>;

export const divisions = (divisionsRaw as DivisionsFile).divisions ?? [];
export const districts = (districtsRaw as DistrictsFile).districts ?? [];
export const upazilas = (upazilasRaw as UpazilasFile).upazilas ?? [];

const unionsFile = unionsRaw as UnionsFile;

const unionsTable = unionsFile.find(
  (item): item is Extract<UnionsFile[number], { type: "table"; data: UnionItem[] }> =>
    typeof item === "object" &&
    item !== null &&
    "type" in item &&
    item.type === "table" &&
    "data" in item
);

export const unions = unionsTable?.data ?? [];