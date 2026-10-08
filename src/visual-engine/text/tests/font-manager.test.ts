import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { FontFamily, Typeface } from '../font-family.js';
import {
    FontManager,
    FontSourceKind,
    RegisteredFont,
    type FontConsumer,
} from '../font-manager.js';
import { FontWeight, FontStyle } from '../formatted-text.js';

describe('FontFamily / Typeface', () => {

    test('Source, Name, and FamilyNames split the CSS stack', () => {
        const ff = new FontFamily('Inter, system-ui, sans-serif');
        assert.equal(ff.Source, 'Inter, system-ui, sans-serif');
        assert.equal(ff.Name, 'Inter');
        assert.deepEqual(ff.FamilyNames, ['Inter', 'system-ui', 'sans-serif']);
    });

    test('from() passes a FontFamily through and wraps a string', () => {
        const ff = new FontFamily('Roboto');
        assert.equal(FontFamily.from(ff), ff);
        assert.equal(FontFamily.from('Roboto').Source, 'Roboto');
    });

    test('Equals compares by source', () => {
        assert.ok(new FontFamily('Inter').Equals(new FontFamily('Inter')));
        assert.ok(!new FontFamily('Inter').Equals(new FontFamily('Roboto')));
        assert.ok(!new FontFamily('Inter').Equals(null));
    });

    test('Typeface combines family + weight + style', () => {
        const tf = new Typeface('Inter', FontWeight.Bold, FontStyle.Italic);
        assert.equal(tf.Family.Source, 'Inter');
        assert.equal(tf.Weight, FontWeight.Bold);
        assert.equal(tf.Style, FontStyle.Italic);
        assert.ok(tf.Equals(new Typeface(new FontFamily('Inter'), FontWeight.Bold, FontStyle.Italic)));
        assert.ok(!tf.Equals(new Typeface('Inter')));
    });
});

describe('FontManager', () => {

    function buf(): ArrayBuffer { return new Uint8Array([1, 2, 3]).buffer; }

    test('Register stores a face and Has reports the family', () => {
        const fm = new FontManager();
        fm.Register('Inter', { kind: FontSourceKind.Buffer, data: buf() });
        assert.ok(fm.Has('Inter'));
        assert.ok(!fm.Has('Nope'));
        assert.equal(fm.Faces.length, 1);
        assert.equal(fm.Faces[0]!.Weight, FontWeight.Normal);
        assert.equal(fm.Faces[0]!.Style, FontStyle.Normal);
    });

    test('faces are keyed by (family, weight, style) — re-register replaces', () => {
        const fm = new FontManager();
        fm.Register('Inter', { kind: FontSourceKind.Buffer, data: buf() });
        fm.Register('Inter', { kind: FontSourceKind.Buffer, data: buf() }, { weight: FontWeight.Bold });
        fm.Register('Inter', { kind: FontSourceKind.Buffer, data: buf() }); // replaces face #1
        assert.equal(fm.Faces.length, 2);
        const keys = fm.Faces.map(f => f.Key).sort();
        assert.deepEqual(keys, ['Inter|bold|normal', 'Inter|normal|normal']);
    });

    test('Subscribe replays existing faces and streams new ones', () => {
        const fm = new FontManager();
        fm.Register('A', { kind: FontSourceKind.Buffer, data: buf() });
        const seen: string[] = [];
        const consumer: FontConsumer = { ReceiveFont: (f: RegisteredFont) => seen.push(f.Key) };
        const unsub = fm.Subscribe(consumer);
        assert.deepEqual(seen, ['A|normal|normal']);           // replay
        fm.Register('B', { kind: FontSourceKind.Buffer, data: buf() }, { style: FontStyle.Italic });
        assert.deepEqual(seen, ['A|normal|normal', 'B|normal|italic']); // streamed
        unsub();
        fm.Register('C', { kind: FontSourceKind.Buffer, data: buf() });
        assert.equal(seen.length, 2);                          // no more after unsubscribe
    });

    test('SourceUrl returns the URL for url faces, undefined for buffers', () => {
        const fm = new FontManager();
        const urlFace = fm.Register('U', { kind: FontSourceKind.Url, url: '/fonts/u.ttf' });
        const bufFace = fm.Register('B', { kind: FontSourceKind.Buffer, data: buf() });
        assert.equal(fm.SourceUrl(urlFace), '/fonts/u.ttf');
        assert.equal(fm.SourceUrl(bufFace), undefined);
    });

    test('LoadBuffer resolves a buffer source immediately and caches it', async () => {
        const fm = new FontManager();
        const data = buf();
        const face = fm.Register('B', { kind: FontSourceKind.Buffer, data });
        const a = await fm.LoadBuffer(face);
        const b = await fm.LoadBuffer(face);
        assert.equal(a, data);
        assert.equal(a, b);
    });

    test('Clear drops faces and consumers', () => {
        const fm = new FontManager();
        const seen: string[] = [];
        fm.Subscribe({ ReceiveFont: f => seen.push(f.Key) });
        fm.Register('A', { kind: FontSourceKind.Buffer, data: buf() });
        fm.Clear();
        assert.equal(fm.Faces.length, 0);
        fm.Register('B', { kind: FontSourceKind.Buffer, data: buf() });
        assert.equal(seen.length, 1);   // only the pre-Clear 'A'; consumer was dropped
    });

    test('Current is a singleton', () => {
        assert.equal(FontManager.Current, FontManager.Current);
    });

    describe('ResolveSourceUrl', () => {

        test('resolves a relative source against a valid module base', () => {
            assert.equal(
                FontManager.ResolveSourceUrl('./fonts/Inter.woff2', 'https://host/app/theme.js'),
                'https://host/app/fonts/Inter.woff2');
        });

        test('an undefined base (bundler-stubbed import.meta) does NOT throw', () => {
            // The bug that blanked the html-bundle app: `new URL(rel, undefined)`
            // throws. The resolver must degrade, returning the source unchanged
            // when no base is available off-DOM.
            assert.doesNotThrow(() => FontManager.ResolveSourceUrl('./fonts/Inter.woff2', undefined));
            assert.equal(FontManager.ResolveSourceUrl('./fonts/Inter.woff2', undefined), './fonts/Inter.woff2');
        });

        test('an empty-string base is treated as no base', () => {
            assert.equal(FontManager.ResolveSourceUrl('./x.woff2', ''), './x.woff2');
        });

        test('an already-absolute source survives any base', () => {
            assert.equal(
                FontManager.ResolveSourceUrl('https://cdn/x.woff2', undefined),
                'https://cdn/x.woff2');
        });
    });
});
