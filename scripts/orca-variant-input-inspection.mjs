// Inspection-only report of OrcaSlicer v2.5.0's printer/filament variant inputs.
// It deliberately does not reimplement native get_config_index_base or choose
// a filament variant. Native selection also depends on nozzle volume statistics.
export const ORCA_VARIANT_SOURCE=Object.freeze({
  repository:"OrcaSlicer/OrcaSlicer",
  commit:"40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19",
  files:["src/libslic3r/PrintConfig.cpp","src/libslic3r/PresetBundle.cpp","tests/libslic3r/test_config_variant_expansion.cpp"]
});
function vector(settings,key) {
  const value=settings[key];
  if(value===undefined)return null;
  if(!Array.isArray(value)||value.length>64)throw new Error("Invalid variant vector: "+key);
  for(let i=0;i<value.length;i++)if(!Object.hasOwn(value,i))throw new Error("Sparse variant vector: "+key);
  return value.slice();
}
export function inspectOrcaVariantInputs(machine,filament) {
  if(!machine||machine.type!=="machine"||!machine.settings||
     !filament||filament.type!=="filament"||!filament.settings)
    throw new Error("Expected resolved machine and filament profiles");
  const m=machine.settings,f=filament.settings;
  const nozzles=vector(m,"nozzle_diameter");
  if(!nozzles||!nozzles.length||nozzles.length>16)
    throw new Error("Invalid machine nozzle_diameter vector");
  const report={
    source:ORCA_VARIANT_SOURCE,
    machine:machine.name,filament:filament.name,
    physicalNozzleCount:nozzles.length,
    machineInputs:{
      extruder_type:vector(m,"extruder_type"),
      nozzle_volume_type:vector(m,"nozzle_volume_type"),
      extruder_variant_list:vector(m,"extruder_variant_list"),
      nozzle_volume:vector(m,"nozzle_volume"),
      nozzle_type:vector(m,"nozzle_type"),
      extruder_offset:vector(m,"extruder_offset")
    },
    filamentInputs:{
      filament_extruder_variant:vector(f,"filament_extruder_variant"),
      filament_map:vector(f,"filament_map"),
      filament_volume_map:vector(f,"filament_volume_map"),
      nozzle_temperature:vector(f,"nozzle_temperature"),
      nozzle_temperature_initial_layer:vector(f,"nozzle_temperature_initial_layer"),
      filament_flow_ratio:vector(f,"filament_flow_ratio"),
      filament_max_volumetric_speed:vector(f,"filament_max_volumetric_speed"),
      filament_diameter:vector(f,"filament_diameter")
    },
    nativeResolutionInputsMissing:[],
    selectedVariantIndex:null,
    usableForPrinting:false
  };
  for(const [group,values] of Object.entries({machine:report.machineInputs,filament:report.filamentInputs}))
    for(const [key,value] of Object.entries(values))
      if(value===null)report.nativeResolutionInputsMissing.push(group+"."+key);
  report.notes=[
    "filament_map maps filament slots to 1-based physical extruder IDs; it is not the filament variant index.",
    "Native get_filament_variant_index also uses printer extruder_type and nozzle volume type.",
    "A printer with several nozzles can still have one extruder variant; nozzle count alone does not imply variant count.",
    "No variant is selected and no vector is forwarded to WASM by this inspector."
  ];
  return report;
}
