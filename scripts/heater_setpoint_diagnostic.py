"""Read-only nozzle/bed setpoint comparison for native/WASM G-code diagnostics.

This reports explicit G-code requests, not measured temperatures, printer
profile equality, or independently validated machine safety.
"""
from decimal import Decimal
import re

HEATER = re.compile(r'^M0*(104|109|140|190)(?:\.0+)?$', re.I)
PARAM = re.compile(r'^([A-Za-z])([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$')


def extract_heater_events(commands):
    """Extract ordered explicit S/R requests; unknown syntax yields None."""
    events = []
    for _, command in commands:
        words = command.split()
        if words and re.fullmatch(r'N\d+', words[0], re.I):
            words = words[1:]
        if not words:
            continue
        opcode = words[0].upper()
        match = HEATER.fullmatch(opcode)
        if match is None:
            if re.match(r'^M0*(?:104|109|140|190)(?=[A-Za-z.]|$)', opcode):
                return None  # Unknown compact/alternate heater syntax.
            continue
        code = int(match[1])
        values = {}
        for token in words[1:]:
            parameter = PARAM.fullmatch(token)
            if parameter is None:
                return None
            key = parameter[1].upper()
            if key not in ('S', 'R', 'T') or key in values:
                return None
            values[key] = Decimal(parameter[2])
        if ('S' in values) == ('R' in values):
            return None
        if code in (140, 190) and 'T' in values:
            return None
        mode = 'S' if 'S' in values else 'R'
        target = values[mode]
        if not target.is_finite() or not 0 <= target <= 1000:
            return None
        tool = values.get('T')
        if tool is not None and (not tool.is_finite() or
                                 tool != tool.to_integral_value() or
                                 not 0 <= tool <= 254):
            return None
        events.append({
            'heater': 'nozzle' if code in (104, 109) else 'bed',
            'command': 'M' + str(code),
            'mode': mode,
            'setpoint_c': format(target.normalize(), 'f'),
            # No implicit current-tool inference across firmware dialects.
            'tool': None if tool is None else int(tool),
        })
    return events


def heater_setpoint_differences(native_commands, wasm_commands):
    """Count every difference, return at most 15 numeric-only examples."""
    native = extract_heater_events(native_commands)
    wasm = extract_heater_events(wasm_commands)
    if native is None or wasm is None:
        return {
            'native_heater_setpoint_events': None if native is None else len(native),
            'wasm_heater_setpoint_events': None if wasm is None else len(wasm),
            'heater_setpoint_difference_count': None,
            'first_heater_setpoint_differences': None,
        }
    differences = 0
    samples = []
    for index in range(max(len(native), len(wasm))):
        a = native[index] if index < len(native) else None
        b = wasm[index] if index < len(wasm) else None
        if a == b:
            continue
        differences += 1
        if len(samples) >= 15:
            continue
        entry = {'event_index': index, 'native': a, 'wasm': b}
        if a is not None and b is not None and all(
                a[key] == b[key] for key in ('heater', 'command', 'mode', 'tool')):
            entry['wasm_minus_native_setpoint_c'] = format(
                (Decimal(b['setpoint_c']) - Decimal(a['setpoint_c'])).normalize(), 'f')
        samples.append(entry)
    return {
        'native_heater_setpoint_events': len(native),
        'wasm_heater_setpoint_events': len(wasm),
        'heater_setpoint_difference_count': differences,
        'first_heater_setpoint_differences': samples,
    }
