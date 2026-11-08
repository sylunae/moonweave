import bisect
import collections
import json
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(__file__).resolve().parent
data = next(ROOT.glob('*.mid')).read_bytes()
assert data[:4] == b'MThd'
header_len = int.from_bytes(data[4:8], 'big')
fmt, track_count, division = struct.unpack('>HHH', data[8:14])
pos = 8 + header_len
events, track_info, last_tick = [], [], 0

def vlq(buf, p):
    value = 0
    while True:
        b = buf[p]
        p += 1
        value = (value << 7) | (b & 127)
        if b < 128:
            return value, p

for tr in range(track_count):
    assert data[pos:pos+4] == b'MTrk'
    size = int.from_bytes(data[pos+4:pos+8], 'big')
    buf = data[pos+8:pos+8+size]
    pos += size + 8
    p = tick = 0
    running = None
    info = {'track': tr, 'names': [], 'programs': []}
    while p < len(buf):
        delta, p = vlq(buf, p)
        tick += delta
        last_tick = max(last_tick, tick)
        if buf[p] >= 128:
            status = buf[p]
            p += 1
            if status < 240:
                running = status
        else:
            assert running is not None
            status = running
        if status == 255:
            typ = buf[p]
            p += 1
            n, p = vlq(buf, p)
            payload = buf[p:p+n]
            p += n
            events.append((tick, tr, len(events), 'meta', typ, payload))
            if typ in (3, 4):
                info['names'].append(payload.decode('utf-8', errors='replace'))
            running = None
        elif status in (240, 247):
            n, p = vlq(buf, p)
            p += n
            running = None
        else:
            typ, ch = status >> 4, status & 15
            n = 1 if typ in (12, 13) else 2
            payload = list(buf[p:p+n])
            p += n
            events.append((tick, tr, len(events), typ, ch, payload))
            if typ == 12:
                info['programs'].append((ch, payload[0]))
    track_info.append(info)

events.sort()
tempos = {0: 500000}
meters = []
for tick, tr, order, typ, ch, payload in events:
    if typ == 'meta' and ch == 81:
        tempos[tick] = int.from_bytes(payload, 'big')
    if typ == 'meta' and ch == 88:
        meters.append((tick, payload[0], 2 ** payload[1]))
tempo_ticks = sorted(tempos)
tempo_ms = [0.0]
if division & 32768:
    fps_code = 256 - (division >> 8)
    fps = 30000 / 1001 if fps_code == 29 else fps_code
    ticks_per_second = fps * (division & 255)
    def ms(t):
        return t * 1000 / ticks_per_second
else:
    for a, b in zip(tempo_ticks, tempo_ticks[1:]):
        tempo_ms.append(tempo_ms[-1] + (b-a) * tempos[a] / division / 1000)
    def ms(t):
        i = bisect.bisect_right(tempo_ticks, t) - 1
        return tempo_ms[i] + (t-tempo_ticks[i]) * tempos[tempo_ticks[i]] / division / 1000

active = collections.defaultdict(collections.deque)
pedal = collections.defaultdict(bool)
sustained = collections.defaultdict(list)
source = []
warnings = []
def finish(note, key_end, sound_end):
    note.update(end=key_end, sound_end=sound_end)
    source.append(note)

for tick, tr, order, typ, ch, payload in events:
    key = (tr, ch)
    if typ == 9 and payload[1] > 0:
        active[(tr, ch, payload[0])].append(dict(track=tr, channel=ch, pitch=payload[0], velocity=payload[1], tick=tick))
    elif typ == 8 or (typ == 9 and payload[1] == 0):
        q = active[(tr, ch, payload[0])]
        if q:
            note = q.popleft()
            if pedal[key]:
                sustained[key].append((note, tick))
            else:
                finish(note, tick, tick)
    elif typ == 11 and payload[0] == 64:
        down = payload[1] >= 64
        if pedal[key] and not down:
            for note, release in sustained[key]:
                finish(note, release, tick)
            sustained[key].clear()
        pedal[key] = down
for q in active.values():
    for note in q:
        warnings.append('missing note-off')
        finish(note, last_tick, last_tick)
for pending in sustained.values():
    for note, release in pending:
        finish(note, release, last_tick)
source.sort(key=lambda n: (n['tick'], n['track'], n['pitch']))

def analyze():
    print('format, division, last_tick, duration', fmt, division, last_tick, ms(last_tick))
    print('tempos', [(t, round(60000000 / tempos[t], 6)) for t in tempo_ticks])
    print('meters', meters)
    for info in track_info:
        ns = [n for n in source if n['track'] == info['track']]
        print(info, 'notes', len(ns), 'channels', dict(collections.Counter(n['channel'] for n in ns)))
        if ns:
            print('pitch', min(n['pitch'] for n in ns), max(n['pitch'] for n in ns), 'velocity', min(n['velocity'] for n in ns), max(n['velocity'] for n in ns))
            print('durations beats', collections.Counter(round((n['end']-n['tick']) / division, 3) for n in ns).most_common(12))
            print('first', [(n['tick']/division, n['pitch'], (n['end']-n['tick'])/division, n['velocity']) for n in ns[:24]])
    for start in range(0, last_tick, division * 16):
        ns = [n for n in source if start <= n['tick'] < start + division * 16]
        print('beats', start/division, 'tracks', dict(collections.Counter(n['track'] for n in ns)), 'onsets', len(set(n['tick'] for n in ns)))

def make_chart():
    assert not division & 32768, 'This arrangement uses PPQ.'
    grouped = collections.defaultdict(list)
    for n in source:
        if n['end'] > n['tick']:
            grouped[(n['track'], n['tick'])].append(n)

    # Musical phrases follow the 3/4 score, including the six-beat handover.
    boundaries = [0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132,
                  144, 156, 168, 174, 186, 198, 210, 222, 234, 246,
                  258, 270, 276, 288, 294]
    voices = collections.defaultdict(list)
    for (tr, tick), ns in sorted(grouped.items(), key=lambda x: (x[0][1], x[0][0])):
        ns.sort(key=lambda n: n['pitch'])
        if tr == 1:
            role = 'melody' if tick < 172.5 * division or tick >= 276 * division else 'harmony'
        elif tr == 3:
            role = 'melody'
        elif tr in (2, 4):
            role = 'bass' if tr == 2 else 'harmony'
        else:
            continue
        # Octave doublings remain one musical gesture; independent chord tones
        # provide the extra keys. The third staff is the singing voice after 172.5.
        if role == 'harmony' and tr == 1:
            lead = grouped.get((3, tick), [])
            lead_pc = {n['pitch'] % 12 for n in lead}
            filtered = [n for n in ns if n['pitch'] % 12 not in lead_pc]
            if not filtered:
                continue
            ns = filtered
        pcs = len(set(n['pitch'] % 12 for n in ns))
        if role == 'bass':
            count = 2 if pcs >= 3 else 1
            pitch_note = ns[0]
        elif role == 'melody':
            count = 1 if pcs == 1 else 2 if pcs <= 3 else 3
            pitch_note = ns[-1]
        else:
            count = 1 if pcs <= 2 else 2
            pitch_note = ns[-1]
        item = dict(tick=tick, end=pitch_note['end'], pitch=pitch_note['pitch'],
                    count=count, role=role, track=tr, pcs=pcs,
                    pitches=[n['pitch'] for n in ns])
        voices[role].append(item)

    # Optimize melodic fingers over complete phrases, then reuse the same
    # fingering for exact/transposed repetitions. Pitch repetitions favour jacks;
    # rising and falling figures retain their contour without wrapping blindly.
    motif_cache = {}
    for role, items in voices.items():
        for begin, end in zip(boundaries, boundaries[1:]):
            phrase = [g for g in items if begin*division <= g['tick'] < end*division]
            if not phrase:
                continue
            root_pitch = phrase[0]['pitch']
            signature = (role, tuple((g['tick']-begin*division,
                         g['end']-g['tick'], g['pitch']-root_pitch,
                         g['count']) for g in phrase))
            if signature in motif_cache:
                lanes = motif_cache[signature]
            else:
                paths = {lane: (abs(lane-(1 if role == 'bass' else 2))*0.16, [lane]) for lane in range(4)}
                for a, b in zip(phrase, phrase[1:]):
                    next_paths = {}
                    delta = b['pitch'] - a['pitch']
                    gap = (b['tick']-a['tick']) / division
                    for lane in range(4):
                        choices = []
                        for prev, (cost, path) in paths.items():
                            move = lane-prev
                            if delta == 0:
                                step = 0 if move == 0 else 2.8 + abs(move)*0.15
                            else:
                                step = 0 if move*delta > 0 else 1.6 if move else 2.4
                                step += abs(abs(move)-min(2, max(1, abs(delta)//4))) * 0.22
                                if gap <= 0.26 and move == 0:
                                    step += 4
                                if abs(delta) <= 4 and abs(move) == 3:
                                    step += 1
                            choices.append((cost+step, path+[lane]))
                        next_paths[lane] = min(choices, key=lambda x: (x[0], x[1]))
                    paths = next_paths
                lanes = min(paths.values(), key=lambda x: (x[0], x[1]))[1]
                motif_cache[signature] = lanes
            for g, lane in zip(phrase, lanes):
                g['preferred'] = lane

    by_tick = collections.defaultdict(list)
    for items in voices.values():
        for g in items:
            by_tick[g['tick']].append(g)
    notes = []
    occupied_until = [-1]*4
    last_press = [-1000000]*4
    last_voice = {}
    coverage = collections.Counter()
    wanted = collections.Counter()
    layout_cache = {}
    for tick, groups in sorted(by_tick.items()):
        groups.sort(key=lambda g: ({'melody': 0, 'bass': 1, 'harmony': 2}[g['role']], g['track']))
        available = {lane for lane in range(4) if occupied_until[lane] <= tick}
        phrase_index = bisect.bisect_right(boundaries, tick/division)-1
        phrase_start = boundaries[phrase_index]*division
        requests = []
        # Every independent voice gets its onset before any chord expansion.
        for g in groups:
            wanted[g['role']] += 1
            requests.append((g, 0))
        for g in groups:
            for extra in range(1, g['count']):
                requests.append((g, extra))
        selected = []
        for g, extra in requests:
            if not available:
                break
            role = g['role']
            previous = last_voice.get((role, g['track']))
            signature = (role, g['track'], tick-phrase_start,
                         tuple(p-g['pitch'] for p in g['pitches']), extra,
                         tuple(h['pitch']-g['pitch'] for h in groups))
            # Same phrase shape, same lanes when the sustained context permits.
            cached = layout_cache.get(signature)
            def lane_cost(lane):
                cost = abs(lane-g['preferred'])*0.9
                if cached is not None:
                    cost += 0 if lane == cached else 3.2
                if previous and extra == 0:
                    old_pitch, old_lane, old_tick = previous
                    movement = lane-old_lane
                    pitch_delta = g['pitch']-old_pitch
                    if pitch_delta == 0 and tick-old_tick <= 3*division:
                        cost += 0 if movement == 0 else 4
                    elif pitch_delta and movement*pitch_delta < 0:
                        cost += 1.0
                # Avoid accidental rapid same-finger transitions between voices.
                gap = ms(tick)-ms(last_press[lane]) if last_press[lane] >= 0 else 10000
                if gap < 180:
                    cost += (180-gap)/30
                if extra:
                    own = [s['lane'] for s in selected if s['group'] is g]
                    if own:
                        cost += 0.25*abs(abs(lane-own[0])-2)
                return cost, lane
            lane = min(available, key=lane_cost)
            available.remove(lane)
            layout_cache.setdefault(signature, lane)
            selected.append(dict(group=g, lane=lane, extra=extra))
            if extra == 0:
                coverage[role] += 1
                last_voice[(role, g['track'])] = (g['pitch'], lane, tick)

        # Preserve written key releases, never pedal tails. At most two fingers
        # are reserved for sustained voices, leaving room for accompaniment.
        held = sum(end > tick for end in occupied_until)
        for s in selected:
            g, lane, extra = s['group'], s['lane'], s['extra']
            length = g['end']-tick
            hold = (extra == 0 and held < 2 and
                    ((g['role'] == 'melody' and length >= division) or
                     (g['role'] != 'melody' and length >= division*1.5)))
            # A future primary melody onset must always have a free finger.
            if hold:
                held += 1
                occupied_until[lane] = g['end']
            else:
                occupied_until[lane] = tick
            n = dict(id=f'vr1-{tick:06d}-{lane}', kind='hold' if hold else 'note',
                     lane=lane, time=round(ms(tick), 6))
            if hold:
                n['endTime'] = round(ms(g['end']), 6)
            notes.append(n)
            last_press[lane] = tick

    notes.sort(key=lambda n: (n['time'], n['lane']))
    def valid_bpm(tempo):
        bpm = 60000000/tempo
        while bpm < 20:
            bpm *= 2
        while bpm > 400:
            bpm /= 2
        return bpm
    changes = []
    current_bpm = valid_bpm(tempos[0])
    for tick in tempo_ticks[1:]:
        bpm = valid_bpm(tempos[tick])
        if bpm != current_bpm:
            changes.append(dict(time=round(ms(tick), 6), bpm=bpm))
            current_bpm = bpm
    chart = dict(version=1, title='周而复始的春色 Vernal Rêverie', artist='',
                 audioPath='', audioName='', backgroundPath='', backgroundName='',
                 backgroundType='', backgroundVideoStartTime=0, coverPath='', coverName='',
                 bpm=valid_bpm(tempos[0]), bpmChanges=changes, effects=[], offset=0,
                 duration=round(ms(max(last_tick, max(n['sound_end'] for n in source)))+1000, 6),
                 notes=notes, aiImportHistory=[], settings=dict(editorZoom=230))

    # Validate both native-chart constraints and coverage against the actual MIDI.
    assert coverage == wanted, (coverage, wanted)
    assert len({n['id'] for n in notes}) == len(notes)
    for lane in range(4):
        end = -1
        for n in [n for n in notes if n['lane'] == lane]:
            assert n['time'] >= end, (lane, n, end)
            assert 0 <= n['time'] < chart['duration']
            end = n.get('endTime', n['time'])
            assert end <= chart['duration']
            if n['kind'] == 'hold':
                assert end > n['time']
    for time in sorted(set(n['time'] for n in notes)):
        active_holds = [n for n in notes if n['kind'] == 'hold' and n['time'] < time < n['endTime']]
        heads = [n for n in notes if n['time'] == time]
        assert len(active_holds)+len(heads) <= 4
    actual_onsets = {round(ms(n['tick']), 6) for n in source}
    assert all(n['time'] in actual_onsets for n in notes)
    key_ends = {(round(ms(n['tick']), 6), round(ms(n['end']), 6)) for n in source}
    assert all((n['time'], n['endTime']) in key_ends for n in notes if n['kind'] == 'hold')
    (OUT/'chart.json').write_text(json.dumps(chart, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print('Notes', len(notes), 'holds', sum(n['kind']=='hold' for n in notes))
    print('Voice onset coverage', dict(coverage), '/', dict(wanted))
    print('Lane counts', dict(collections.Counter(n['lane'] for n in notes)))
    print('Chord sizes', dict(collections.Counter(sum(n['time']==t for n in notes) for t in sorted(actual_onsets))))
    print('Duration', chart['duration'], 'BPM changes', len(changes), 'motifs', len(motif_cache))

if __name__ == '__main__':
    import sys
    if '--analyze' in sys.argv:
        analyze()
    else:
        make_chart()
