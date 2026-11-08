"""Phrase-led revision of the supplied V2 chart; Python standard library only.

Run from any directory. A new exported context may be passed with --context.
No library data is written and no context revision is computed or bypassed.
"""
import argparse
import copy
import itertools
import json
from collections import Counter, defaultdict
from pathlib import Path
from uuid import uuid4

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
EPS = 1e-7
RECOVERY = 0.25  # 120 ms at the supplied 125 BPM, after a same-lane hold.


def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def phrase_reference(start):
    """Explicit musical plan, rather than random/rotating lane selection.

    Main theme: A A mirror(A) mirror(A), with local endings left intact.
    Second statement mirrors its corresponding first statement.
    Exposed line alternates the phrase's hand assignment.
    Return's 16-beat antecedent/consequent is mirrored on repetition.
    Reprise and final variation keep corresponding eight-beat vocabulary.
    """
    if start == 8:
        return 0, False
    if start == 24:
        return 16, False
    if 32 <= start < 96:
        return 32, ((start - 32) % 32 >= 16) ^ (start >= 64)
    if 96 <= start < 128:
        return None, False
    if 128 <= start < 160:
        return 128, ((start - 128) // 8) % 2 == 1
    if start == 176:
        return 160, True
    if start == 184:
        return 168, True
    if 240 <= start < 272:
        return start - 32, True
    if 272 <= start < 304:
        return start - 176, True
    if 304 <= start < 332:
        return 96 + start - 304, False
    return None, False


# Deliberate four-beat gestures. Each entry is (preferred taps, preferred holds).
# Half-beat chord pairs alternate outer/inner and left/right roles. The extra
# quarter/eighth-beat attacks answer with the other hand whenever available.
GESTURES = {
    0: ((0, 2, 3), (3, 0)),
    .25: ((1,), (1,)),
    .5: ((1, 2), (2,)),
    .625: ((0,), (0,)),
    .75: ((0, 3), (0,)),
    .875: ((2,), (2,)),
    1: ((0, 2), (2,)),
    1.25: ((3,), (3,)),
    1.375: ((0,), (0,)),
    1.5: ((1, 3), (3,)),
    1.75: ((2,), (2,)),
    1.875: ((0,), (0,)),
    2: ((0, 1, 2), (0, 3)),
    2.25: ((3,), (3,)),
    2.5: ((1, 3), (1,)),
    2.625: ((0,), (0,)),
    2.75: ((2,), (2,)),
    2.875: ((1,), (1,)),
    3: ((0, 2, 3), (2,)),
    3.25: ((1,), (1,)),
    3.375: ((3,), (3,)),
    3.5: ((1, 2), (1,)),
    3.75: ((0,), (0,)),
    3.875: ((3,), (3,)),
}


def prepare_events(notes):
    grouped = defaultdict(list)
    for note in notes:
        grouped[note['beat']].append(copy.deepcopy(note))
    result = []
    sustained_until = []
    for beat, original in sorted(grouped.items()):
        holds = sorted((n for n in original if n['kind'] == 'hold'),
                       key=lambda n: (-(n['endBeat'] - beat), n['id']))
        taps = sorted((n for n in original if n['kind'] == 'note'), key=lambda n: n['id'])
        # The common main-theme figure has one sustained melody and a three-key
        # accent. Additional doublings formerly changed the motif and occupied
        # a second finger throughout otherwise identical statements.
        if 32 <= beat < 96 and (beat % 8) in (0, 2, 4):
            taps.extend({**n, 'kind': 'note'} for n in holds[1:])
            holds = holds[:1]
            for n in taps:
                n.pop('endBeat', None)
            taps = taps[:max(0, 3 - len(holds))]
        # Preserve all selected musical attack times in the reported pressure
        # bursts, while removing duplicated chord voices at these attacks.
        if 160 <= beat < 164 or 176 <= beat < 180:
            taps = taps[:max(0, 2 - len(holds))]
        # Three sustained fingers plus fast melody ornaments leave one finger
        # for every following attack. Keep at most two concurrent sustained
        # voices; their other chord doublings retain their original attack.
        sustained_until = [end for end in sustained_until if end > beat - EPS]
        hold_capacity = max(0, 2 - len(sustained_until))
        for note in holds[hold_capacity:]:
            tap = {**note, 'kind': 'note'}
            tap.pop('endBeat', None)
            taps.append(tap)
        holds = holds[:hold_capacity]
        sustained_until.extend(n['endBeat'] for n in holds)
        result.append({'beat': beat, 'holds': holds, 'taps': taps,
                       'originalCount': len(original)})
    # Plan the shared main-theme core with space reserved for ALL genuine
    # decorations in its four statements. Absent decorations are planning
    # placeholders only: they never become output notes. This prevents the
    # third phrase's extra ornaments from forcing a wholly new core layout.
    main_offsets = {round(e['beat'] % 8, 6) for e in result if 32 <= e['beat'] < 64}
    for start in range(32, 96, 8):
        present = {round(e['beat'] - start, 6) for e in result if start <= e['beat'] < start + 8}
        for rel in main_offsets - present:
            beat = start + rel
            result.append({'beat': beat, 'holds': [], 'taps': [{'id': 'planning-only', 'kind': 'note', 'lane': 0, 'beat': beat}],
                           'originalCount': 0, 'phantom': True})
    return sorted(result, key=lambda e: e['beat'])


def preferred(event, reference, mirror):
    rel = round(event['beat'] % 8, 6)
    if rel in reference:
        mask, hold_lanes = reference[rel]
        return ((tuple(3 - lane for lane in mask), tuple(3 - lane for lane in hold_lanes), True)
                if mirror else (mask, hold_lanes, True))
    phase = round(event['beat'] % 4, 6)
    mask, hold_lanes = GESTURES.get(phase, ((0, 2), (3,)))
    return mask, hold_lanes, False


def candidates(event, state, desired):
    last, releases, hand_last, hand_runs = state
    beat = event['beat']
    available = tuple(lane for lane in range(4)
                      if beat - last[lane] >= .25 - EPS
                      and beat - releases[lane] >= RECOVERY - EPS)
    count = len(event['holds']) + len(event['taps'])
    hold_count = len(event['holds'])
    # If recovering hold fingers leave fewer lanes, omit an accompaniment
    # doubling, never a distinct attack time or an existing sustained melody.
    keep = min(count, len(available))
    if keep < max(1, hold_count):
        return
    desired_mask, desired_holds, referenced = desired
    for mask in itertools.combinations(available, keep):
        for hold_lanes in itertools.permutations(mask, hold_count):
            tap_lanes = tuple(lane for lane in mask if lane not in hold_lanes)
            cost = (count - keep) * 5000
            cost += len(set(mask) ^ set(desired_mask)) * (160 if referenced else 38)
            cost += sum((240 if referenced else 70) for i, lane in enumerate(hold_lanes)
                        if i < len(desired_holds) and lane != desired_holds[i])
            # Chord shapes express accents; same-hand doubles are not the
            # default replacement for a balanced left/right two-key chord.
            if len(mask) == 2 and mask[0] // 2 == mask[1] // 2:
                cost += 24
            next_last, next_releases = list(last), list(releases)
            for lane in mask:
                delta = beat - last[lane]
                if delta < .5 - EPS:
                    cost += 95
                elif delta < .75 - EPS:
                    cost += 3
                next_last[lane] = beat
            next_hand_last, next_runs = list(hand_last), list(hand_runs)
            for hand in (0, 1):
                if any(lane // 2 == hand for lane in mask):
                    run = hand_runs[hand] + 1 if beat - hand_last[hand] <= .25 + EPS else 1
                    # Four consecutive sixteenth-grid inputs in one hand are
                    # disallowed. At 125 BPM this is the reported overload.
                    if run >= 4:
                        break
                    cost += (0, 0, 14, 180)[run]
                    next_hand_last[hand], next_runs[hand] = beat, run
            else:
                for note, lane in zip(event['holds'], hold_lanes):
                    next_releases[lane] = max(note['endBeat'], beat + 1.5) if 32 <= beat < 96 and beat % 8 in (0, 2, 4) else note['endBeat']
                next_state = (tuple(next_last), tuple(next_releases), tuple(next_hand_last), tuple(next_runs))
                yield cost, next_state, (hold_lanes, tap_lanes), keep


def arrange(events):
    state = ((-100.,) * 4, (-100.,) * 4, (-100.,) * 2, (0, 0))
    atlas, output, omitted = {}, [], []
    for start in range(0, 336, 8):
        chunk = [e for e in events if start <= e['beat'] < start + 8]
        ref_start, mirror = phrase_reference(start)
        reference = atlas.get(ref_start, {})
        beam = [(0., state, [])]
        for event in chunk:
            desired = preferred(event, reference, mirror)
            next_beam = {}
            for total, prev, path in beam:
                for extra, new_state, assignment, keep in candidates(event, prev, desired):
                    score = total + extra
                    prior = next_beam.get(new_state)
                    if prior is None or score < prior[0]:
                        next_beam[new_state] = (score, new_state, path + [(assignment, keep)])
            if not next_beam:
                raise RuntimeError(f'No playable assignment at beat {event["beat"]}')
            beam = sorted(next_beam.values(), key=lambda item: item[0])[:64]
        _, state, path = beam[0]
        atlas[start] = {}
        for event, ((hold_lanes, tap_lanes), keep) in zip(chunk, path):
            beat = event['beat']
            atlas[start][round(beat - start, 6)] = (tuple(sorted(hold_lanes + tap_lanes)), hold_lanes)
            if event.get('phantom'):
                continue
            if keep < len(event['holds']) + len(event['taps']):
                omitted.append({'beat': beat, 'doublings': len(event['holds']) + len(event['taps']) - keep})
            for note, lane in zip(event['holds'], hold_lanes):
                output.append({**note, 'lane': lane})
            for note, lane in zip(event['taps'], tap_lanes):
                output.append({**note, 'lane': lane})
    return sorted(output, key=lambda n: (n['beat'], n['lane'])), omitted


def metrics(notes):
    touching, conflicts, quick_jacks = [], [], []
    for lane in range(4):
        arr = sorted((n for n in notes if n['lane'] == lane), key=lambda n: n['beat'])
        for a, b in zip(arr, arr[1:]):
            if b['beat'] < a.get('endBeat', a['beat']) - EPS or b['beat'] == a['beat']:
                conflicts.append([a['id'], b['id']])
            if a['kind'] == 'hold' and b['beat'] - a['endBeat'] < RECOVERY - EPS:
                touching.append([a['id'], b['id']])
            if b['beat'] - a['beat'] < .5 - EPS:
                quick_jacks.append([a['beat'], b['beat'], lane])
    heads = defaultdict(set)
    for n in notes:
        heads[n['beat']].add(n['lane'] // 2)
    hand_runs = []
    for hand in (0, 1):
        times = [t for t, hs in sorted(heads.items()) if hand in hs]
        run = []
        for t in times:
            if run and t - run[-1] > .25 + EPS:
                if len(run) >= 4:
                    hand_runs.append({'hand': hand, 'start': run[0], 'end': run[-1], 'attacks': len(run)})
                run = []
            run.append(t)
        if len(run) >= 4:
            hand_runs.append({'hand': hand, 'start': run[0], 'end': run[-1], 'attacks': len(run)})
    return {'notes': len(notes), 'holds': sum(n['kind'] == 'hold' for n in notes),
            'laneCounts': [sum(n['lane'] == lane for n in notes) for lane in range(4)],
            'sameLaneConflicts': conflicts, 'holdRecoveryViolations': touching,
            'sameFingerIntervalsUnderHalfBeat': quick_jacks,
            'sameHandRunsAtQuarterBeatFourOrMore': hand_runs}


def correspondence(notes, a, b, width=8, mirror=True):
    def shape(start):
        return {(round(n['beat'] - start, 6), 3 - n['lane'] if mirror and start == b else n['lane'], n['kind'])
                for n in notes if start <= n['beat'] < start + width}
    x, y = shape(a), shape(b)
    return {'first': a, 'second': b, 'beats': width, 'mirror': mirror,
            'sharedHeads': len(x & y), 'firstHeads': len(x), 'secondHeads': len(y),
            'overlap': round(len(x & y) / max(len(x), len(y)), 4)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--context', type=Path, default=ROOT / 'moonweave-ai-context.json')
    args = parser.parse_args()
    context = load(args.context)
    source = load(ROOT / 'VERSION/2/moonweave-ai-chart-midi-master-4k.json')
    assert not context['notesTruncated']
    for key in ('audioName', 'duration', 'bpm', 'bpmChanges'):
        assert context['song'][key] == source['song'][key], 'Song/tempo changed; reanalyse before regenerating.'
    base = source['notes']
    # The fresh export has the user-confirmed offset 180 ms. Its beat positions
    # still match V2; the old V2 file's zero offset must not overwrite it.
    offset = context['song']['offset']
    expected = {(n['id'], n['kind'], n['lane'], round(offset + n['beat'] * 480, 5),
                 round(offset + n['endBeat'] * 480, 5) if 'endBeat' in n else None) for n in base}
    current = {(n['id'], n['kind'], n['lane'], round(n['time'], 5),
                round(n['endTime'], 5) if n['kind'] == 'hold' else None) for n in context['notes']}
    assert current == expected, 'Context contains other musical edits; do not overwrite them with a V2 revision.'
    revised, omitted = arrange(prepare_events(base))
    # These entire statements have the same V2 note/hold timing. Copy the
    # completed musical phrase, rather than letting independent optimization
    # gradually change the second statement's hand order.
    for first, second, width in ((32, 64, 32), (208, 240, 32)):
        phrase = [n for n in revised if first <= n['beat'] < first + width]
        repeated = []
        for note in phrase:
            repeat = {**note, 'lane': 3 - note['lane'], 'beat': note['beat'] + second - first}
            if 'endBeat' in note:
                repeat['endBeat'] = note['endBeat'] + second - first
            repeated.append(repeat)
        revised = [n for n in revised if not second <= n['beat'] < second + width] + repeated
    revised.sort(key=lambda n: (n['beat'], n['lane']))
    for index, note in enumerate(revised, 1):
        note['id'] = f'v3-phrase-{index:04d}'
    document = {key: copy.deepcopy(source[key]) for key in ('format', 'version', 'mode', 'unit', 'song', 'range')}
    document['song'] = copy.deepcopy(context['song'])
    document['range'] = {'start': context['range']['startBeat'], 'end': context['range']['endBeat']}
    document['target'] = copy.deepcopy(context['target'])
    document['requestId'] = f'fohad-phrase-v3-{uuid4()}'
    document['notes'] = revised
    before, after = metrics(base), metrics(revised)
    assert not after['sameLaneConflicts']
    assert not after['holdRecoveryViolations']
    assert not after['sameHandRunsAtQuarterBeatFourOrMore']
    assert len({n['id'] for n in revised}) == len(revised)
    assert {n['beat'] for n in revised} == {n['beat'] for n in base}, 'A musical attack was lost or invented.'
    assert offset + max(n.get('endBeat', n['beat']) for n in revised) * 480 <= context['song']['duration']
    pairs = [(0, 8, 8, False), (16, 24, 8, False), (32, 40, 6, False),
             (32, 48, 6, True), (32, 56, 6, True), (32, 64, 32, True),
             (160, 176, 6, True), (208, 240, 32, True), (96, 272, 24, True)]
    report = {'contextPath': str(args.context.resolve()), 'target': context['target'],
              'song': document['song'], 'before': before, 'after': after,
              'allOriginalAttackTimesPreserved': True, 'releaseRecoveryBeats': RECOVERY,
              'omittedAccompanimentDoublings': omitted,
              'correspondence': [correspondence(revised, *pair) for pair in pairs]}
    (HERE / 'moonweave-ai-chart-phrase-master-4k.json').write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (HERE / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k not in ('before', 'after', 'omittedAccompanimentDoublings')}, ensure_ascii=False, indent=2))
    print('Before:', {k: len(v) if isinstance(v, list) and k != 'laneCounts' else v for k, v in before.items()})
    print('After: ', {k: len(v) if isinstance(v, list) and k != 'laneCounts' else v for k, v in after.items()})


if __name__ == '__main__':
    main()
