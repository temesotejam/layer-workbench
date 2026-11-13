// Semantics copied from named sets in OrcaSlicer v2.5.0 PrintConfig.cpp.
// This is a source-audit aid, not a generic vector-length inference.
export const ORCA_CONFIG_SOURCE = Object.freeze({
  repository:"OrcaSlicer/OrcaSlicer",
  commit:"40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19",
  file:"src/libslic3r/PrintConfig.cpp"
});
const PRINTER_EXTRUDER = new Set([
  "extruder_type","nozzle_diameter","default_nozzle_volume_type",
  "extruder_printable_area","extruder_bed_exclude_volumes",
  "extruder_printable_height","min_layer_height","max_layer_height",
  "extruder_max_nozzle_count"
]);
const PRINTER_VARIANT_1 = new Set([
  "nozzle_volume","retraction_length","z_hop","travel_slope",
  "retract_lift_above","retract_lift_below","retract_lift_enforce",
  "z_hop_types","retraction_speed","deretraction_speed",
  "retraction_minimum_travel","retract_when_changing_layer","wipe",
  "wipe_distance","retract_before_wipe","retract_after_wipe",
  "retract_length_toolchange","retract_restart_extra",
  "retract_restart_extra_toolchange","long_retractions_when_cut",
  "retraction_distances_when_cut","nozzle_type","printer_extruder_id",
  "printer_extruder_variant","hotend_cooling_rate","hotend_heating_rate",
  "nozzle_flush_dataset"
]);
const PRINTER_VARIANT_2 = new Set([
  "machine_max_acceleration_x","machine_max_acceleration_y",
  "machine_max_acceleration_z","machine_max_acceleration_e",
  "machine_max_acceleration_extruding","machine_max_acceleration_retracting",
  "machine_max_acceleration_travel","machine_max_speed_x","machine_max_speed_y",
  "machine_max_speed_z","machine_max_speed_e","machine_max_jerk_x",
  "machine_max_jerk_y","machine_max_jerk_z","machine_max_jerk_e",
  "machine_max_junction_deviation"
]);
const FILAMENT_VARIANT = new Set([
  "filament_retraction_length","filament_z_hop","filament_z_hop_types",
  "filament_retract_lift_above","filament_retract_lift_below",
  "filament_retract_lift_enforce","filament_retraction_speed",
  "filament_deretraction_speed","filament_retract_restart_extra",
  "filament_retraction_minimum_travel","filament_retract_length_toolchange",
  "filament_retract_restart_extra_toolchange","filament_wipe_distance",
  "filament_retract_when_changing_layer","filament_wipe",
  "filament_retract_before_wipe","filament_retract_after_wipe",
  "filament_long_retractions_when_cut","filament_retraction_distances_when_cut",
  "filament_retract_length_nc","filament_ironing_flow","filament_ironing_spacing",
  "filament_ironing_inset","filament_ironing_speed"
]);
export function classifyOrcaArrayOption(key) {
  if(typeof key!=="string"||!key)throw new Error("Invalid Orca option key");
  if(PRINTER_EXTRUDER.has(key))return {key,classification:"printer-extruder",sourceSet:"printer_extruder_options",source:ORCA_CONFIG_SOURCE};
  if(PRINTER_VARIANT_1.has(key))return {key,classification:"printer-variant-1",sourceSet:"printer_options_with_variant_1",source:ORCA_CONFIG_SOURCE};
  if(PRINTER_VARIANT_2.has(key))return {key,classification:"printer-variant-2",sourceSet:"printer_options_with_variant_2",source:ORCA_CONFIG_SOURCE};
  if(FILAMENT_VARIANT.has(key))return {key,classification:"filament-extruder-override",sourceSet:"filament_extruder_override_keys + is_filament_extruder_override_key",source:ORCA_CONFIG_SOURCE};
  return {key,classification:"unclassified",sourceSet:null,source:ORCA_CONFIG_SOURCE};
}
export function auditOrcaArrayOption(key,value) {
  if(!Array.isArray(value))return {key,isArray:false,classification:"not-array"};
  const result=classifyOrcaArrayOption(key);
  return {...result,isArray:true,length:value.length,
    // Do not assume every native option's vector length equals tool count.
    application:"not-forwarded; verify native ConfigDef type and cardinality"};
}
