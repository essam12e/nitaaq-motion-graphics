"""NITAAQ bridge to earshot (MIT, github.com/Leonxlnx/earshot): renders bank sounds aimed at a moment.

Uses only earshot's model-free bank (pure DSP: no torch, no network, no recorded audio).
    python tools/earshot_render.py jobs.json        # [{"id", "seed", "dur", "apex", "pitch", "out"}] -> metas JSON on stdout
    python tools/earshot_render.py --list           # the bank: id, dur, peak, kinds, knobs
    python tools/earshot_render.py --version
A take that fails earshot's own audit (clicks, cut tails, clipping...) is re-rolled on the next seed (as `kit render` does).
"""
import json
import sys


def main():
    from earshot.forge import bank
    args = sys.argv[1:]
    if args and args[0] == '--version':
        import earshot
        print(json.dumps({'earshot': getattr(earshot, '__version__', '?'), 'bank': len(bank.ids())}))
        return
    if args and args[0] == '--list':
        out = []
        for e in bank.list_sounds():
            out.append({k: e.get(k) for k in ('id', 'category', 'dur_s', 'peak_s', 'kinds', 'knobs', 'pitch') if k in e})
        print(json.dumps(out))
        return
    import soundfile as sf
    jobs = json.load(open(args[0], encoding='utf-8'))
    res = []
    for j in jobs:
        seed = j.get('seed')
        last = None
        for attempt in range(4):
            s = None if seed is None else int(seed) + attempt * 7919
            try:
                y, meta = bank.render(j['id'], seed=s, dur=j.get('dur'), apex=j.get('apex'), pitch=j.get('pitch'))
            except Exception as ex:  # a knob the recipe refuses (e.g. pitch on a noise sound): render without it
                if j.get('pitch') is not None:
                    j = {**j, 'pitch': None}
                    y, meta = bank.render(j['id'], seed=s, dur=j.get('dur'), apex=j.get('apex'))
                    meta['note'] = f'pitch refused: {str(ex)[:120]}'
                else:
                    raise
            ok = not meta.get('checks') or meta['checks'].get('ok', True)
            last = (y, meta)
            if ok:
                break
        y, meta = last
        sf.write(j['out'], y, meta['sr'], subtype='PCM_24')
        checks = meta.get('checks') or {}
        res.append({'out': j['out'], 'id': meta['id'], 'seed': meta['seed'], 'onset_s': meta['onset_s'], 'peak_s': meta['peak_s'],
                    'end_s': meta['end_s'], 'dur_s': meta['dur_s'], 'peak_db': meta['peak_db'], 'lufs_m_max': meta.get('lufs_m_max'),
                    'clean': bool(checks.get('ok', True)), 'audit': checks.get('summary'), 'edits': {k: str(v) for k, v in (meta.get('edits') or {}).items()},
                    'note': meta.get('note')})
    print(json.dumps(res))


if __name__ == '__main__':
    main()
