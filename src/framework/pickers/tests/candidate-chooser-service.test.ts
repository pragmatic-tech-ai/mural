import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ServiceKey, ServiceProvider } from '../../../runtime/index.js';
import { CandidateChooserService, ChooserRow } from '../candidate-chooser-service.js';

interface Candidate { label: string }

describe('CandidateChooserService', () =>
{
    test('Key is a ServiceKey', () =>
    {
        assert.ok(CandidateChooserService.Key instanceof ServiceKey);
    });

    test('Show opens the popup with one ChooserRow per candidate', () =>
    {
        const svc = new CandidateChooserService(new ServiceProvider());
        assert.equal(svc.IsOpen, false);
        svc.Show<Candidate>([{ label: 'a' }, { label: 'b' }], () => undefined);
        assert.equal(svc.IsOpen, true);
        assert.equal(svc.Rows.Count, 2);
        assert.ok(svc.Rows.Get(0) instanceof ChooserRow);
        assert.deepEqual(svc.Rows.ToArray().map(r => r.Label), ['a', 'b']);
    });

    test('invoking a row command fires onPick with that candidate and dismisses the popup', () =>
    {
        const svc = new CandidateChooserService(new ServiceProvider());
        const a: Candidate = { label: 'a' };
        const b: Candidate = { label: 'b' };
        const picked: Candidate[] = [];
        svc.Show([a, b], (c) => picked.push(c));
        svc.Rows.Get(1)!.Command!.Execute(undefined);
        assert.deepEqual(picked, [b]);
        assert.equal(svc.IsOpen, false);
        assert.equal(svc.Rows.Count, 0);
    });

    test('a second Show replaces the previous rows', () =>
    {
        const svc = new CandidateChooserService(new ServiceProvider());
        svc.Show<Candidate>([{ label: 'a' }, { label: 'b' }], () => undefined);
        svc.Show<Candidate>([{ label: 'c' }], () => undefined);
        assert.deepEqual(svc.Rows.ToArray().map(r => r.Label), ['c']);
    });

    test('raises IsOpen property change', () =>
    {
        const svc = new CandidateChooserService(new ServiceProvider());
        const seen: string[] = [];
        svc.PropertyChanged('IsOpen').subscribe(() => seen.push('IsOpen'));
        svc.Show<Candidate>([{ label: 'a' }], () => undefined);
        assert.deepEqual(seen, ['IsOpen']);
    });
});
