declare module "*.css";
declare module "leaflet.heat";

declare module "leaflet" {
  export function heatLayer(
    latlngs: Array<[number, number, number?]>,
    options?: {
      radius?: number;
      blur?: number;
      maxZoom?: number;
      minOpacity?: number;
      gradient?: Record<number, string>;
    }
  ): any;
}
