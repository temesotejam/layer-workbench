"""Read-only comparison of explicit Marlin-style fan requests.

Compare command words, not effective firmware state, fan roles or measured
speed. Orca's other dialects (e.g. Mach3 P-only or MakerWare M126/M127)
are deliberately unavailable, not guessed.
"""
from decimal import Decimal
import re

FAN = re.compile(r'^M0*(106|107)(?:\.0+)?$', re.I)
FAN_LIKE = re.compile(r'^M0*(?:106|107|126|127)(?=[A-Za-z.]|$)', re.I)
PARAM = re.compile(r'^([SP])([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$', re.I)


def extract_fan_events(commands):
    events = []
    for _, command in commands:
        words = command.split()
        if words and re.fullmatch(r'N\d+', words[0], re.I):
            words = words[1:]
        if not words:
            continue
        match = FAN.fullmatch(words[0])
        if match is None:
            if FAN_LIKE.match(words[0]):
                return None
            continue
        code = int(match[1])
        values = {}
        for token in words[1:]:
            param = PARAM.fullmatch(token)
            if param is None or param[1].upper() in values:
                return None
            values[param[1].upper()] = Decimal(param[2])
        # Do not guess a default M106 speed, a P-only dialect, or an
        # M107 with an opaque speed parameter.
        if (code == 106) != ('S' in values):
            return None
        pwm = values.get('S', Decimal(0))
        index = values.get('P')
        if not pwm.is_finite() or not 0 <= pwm <= 255:
            return None
        if index is not None and (not index.is_finite() or
                                  index != index.to_integral_value() or
                                  not 0 <= index <= 254):
            return None
        events.append({
            'command': 'M' + str(code),
            'fan_index': None if index is None else int(index),
            'pwm_word': format(pwm.normalize(), 'f'),
        })
    return events


def fan_request_differences(native_commands, wasm_commands):
    native = extract_fan_events(native_commands)
    wasm = extract_fan_events(wasm_commands)
    count = None
    samples = None
    if native is not None and wasm is not None:
        count, samples = 0, []
        for i in range(max(len(native), len(wasm))):
            a = native[i] if i < len(native) else None
            b = wasm[i] if i < len(wasm) else None
            if a == b:
                continue
            count += 1
            if len(samples) >= 15:
                continue
            entry = {'event_index': i, 'native': a, 'wasm': b}
            if (a is not None and b is not None and
                    a['command'] == b['command'] == 'M106' and
                    a['fan_index'] == b['fan_index']):
                entry['wasm_minus_native_pwm_word'] = format(
                    (Decimal(b['pwm_word']) - Decimal(a['pwm_word'])).normalize(), 'f')
            samples.append(entry)
    return {
        'native_fan_request_events': None if native is None else len(native),
        'wasm_fan_request_events': None if wasm is None else len(wasm),
        'fan_request_difference_count': count,
        'first_fan_request_differences': samples,
    }
