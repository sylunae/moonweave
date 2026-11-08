"""Retain v1 choreography and retime against the corrected source MIDI."""
import bisect
import collections
import hashlib
import json
from pathlib import Path
import runpy

OUT = Path(__file__).resolve().parent
BASE = OUT.parent / '1'
midi = runpy.run_path(str(BASE / 'make_chart.py'))
chart = json.loads((BASE / 'chart.json').read_text(encoding='utf-8'))
old = json.loads(json.dumps(chart))
ppq = midi['division']
assert ppq == 480
assert not midi['warnings'], midi['warnings']

# Reconstruct the previous grid from the delivered chart, independent of the
# overwritten MIDI. IDs retain original tick coordinates as an extra crosscheck.
times = [0.0] + [c['time'] for c in old['bpmChanges']]
bpms = [old['bpm']] + [c['bpm'] for c in old['bpmChanges']]
beats = [0.0]
for i in range(1, len(times)):
    beats.append(beats[-1] + (times[i]-times[i-1])*bpms[i-1]/60000)

def old_tick(time):
    i = bisect.bisect_right(times, time)-1
    tick = (beats[i] + (time-times[i])*bpms[i]/60000)*ppq
    assert abs(tick-round(tick)) < 0.0001
    return round(tick)

source_starts = sorted(set(n['tick'] for n in midi['source']))
release_adjustments = []
for note in chart['notes']:
    tick = old_tick(note['time'])
    assert tick == int(note['id'].split('-')[1])
    # The new export includes small expressive rolls/articulation changes.
    # Keep the existing arrangement's notated head positions for this tempo fix.
    assert min(abs(tick-t) for t in source_starts) <= 48
    note['time'] = round(midi['ms'](tick), 6)
    if note['kind'] == 'hold':
        end_tick = old_tick(note['endTime'])
        # Use the new export's actual key release when it corresponds to the
        # existing sustained gesture (up to 5% articulation shortening).
        candidates = [n for n in midi['source']
                      if abs(n['tick']-tick) <= 48 and n['end'] > tick
                      and abs(n['end']-end_tick) <= max(2, (end_tick-tick)*0.06)]
        if candidates:
            match = min(candidates, key=lambda n: (abs(n['tick']-tick), abs(n['end']-end_tick)))
            release_adjustments.append((end_tick, match['end']))
            end_tick = match['end']
        note['endTime'] = round(midi['ms'](end_tick), 6)

chart['bpm'] = 60000000 / midi['tempos'][0]
chart['bpmChanges'] = []
current = chart['bpm']
for tick in midi['tempo_ticks'][1:]:
    bpm = 60000000 / midi['tempos'][tick]
    assert 20 <= bpm <= 400
    if bpm != current:
        chart['bpmChanges'].append({'time': round(midi['ms'](tick), 6), 'bpm': bpm})
        current = bpm
chart['duration'] = round(midi['ms'](max(midi['last_tick'], max(n['sound_end'] for n in midi['source'])))+1000, 6)

assert len(chart['notes']) == len(old['notes'])
for before, after in zip(old['notes'], chart['notes']):
    assert {k:v for k,v in before.items() if k not in ('time','endTime')} == {k:v for k,v in after.items() if k not in ('time','endTime')}
    if before['time'] < 56100:
        assert before['time'] == after['time']
assert len({n['id'] for n in chart['notes']}) == len(chart['notes'])
for lane in range(4):
    previous_start = previous_end = -1
    for n in [n for n in chart['notes'] if n['lane'] == lane]:
        assert n['time'] > previous_start
        assert n['time'] >= previous_end
        assert 0 <= n['time'] < chart['duration']
        previous_start = n['time']
        previous_end = n.get('endTime', n['time'])
        assert previous_end <= chart['duration']
        if n['kind'] == 'hold':
            assert previous_end > n['time']
for time in sorted({n['time'] for n in chart['notes']}):
    active = [n for n in chart['notes'] if n['kind']=='hold' and n['time'] < time < n['endTime']]
    heads = [n for n in chart['notes'] if n['time']==time]
    assert len(active)+len(heads) <= 4

# Recover the musical beat of each tempo marker from the output itself.
beat = 0
previous_time = 0
previous_bpm = chart['bpm']
for change, tick in zip(chart['bpmChanges'], midi['tempo_ticks'][1:]):
    beat += (change['time']-previous_time)*previous_bpm/60000
    assert abs(beat-tick/ppq) < 0.000001
    previous_time, previous_bpm = change['time'], change['bpm']

output = OUT / 'chart.json'
output.write_text(json.dumps(chart, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print('Notes:',len(chart['notes']),'holds:',sum(n['kind']=='hold' for n in chart['notes']))
print('Tempo changes:',len(chart['bpmChanges']),'duration:',chart['duration'])
print('Changed head times:',sum(a['time']!=b['time'] for a,b in zip(old['notes'],chart['notes'])))
print('Matched hold releases:',len(release_adjustments))
print('Input SHA256:',hashlib.sha256(midi['data']).hexdigest())
print('All timing, identity, boundary, collision and active-key checks passed.')
