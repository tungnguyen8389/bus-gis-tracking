// Bọc AMD loader của ArcGIS JS SDK (script https://js.arcgis.com/4.29/ nạp sẵn trong <head>) thành Promise
export function loadArcgisModules(names) {
  return new Promise((resolve, reject) => {
    window.require(names, (...modules) => resolve(modules), reject);
  });
}
