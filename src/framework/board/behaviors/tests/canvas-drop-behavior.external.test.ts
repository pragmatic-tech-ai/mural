import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Point } from '../../../../runtime/index.js';
import { DataObject } from '../../../../visual-engine/index.js';
import { parseUriList, MuralDataFormat } from '../../external-drop.js';
import { buildExternalArgs } from '../canvas-drop-behavior.js';

test('parseUriList returns http/file uris and drops comments + blanks', () => {
    const text = '# comment\r\nhttps://example.com/a.png\r\n\r\nfile:///C:/x/y.pdf\r\n';
    assert.deepEqual(parseUriList(text), ['https://example.com/a.png', 'file:///C:/x/y.pdf']);
});

test('parseUriList tolerates a bare single uri with no CRLF', () => {
    assert.deepEqual(parseUriList('https://example.com'), ['https://example.com']);
});

test('buildExternalArgs maps a dropped FileList into args at the given position', () => {
    const fakeFile = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' });
    const data = new DataObject().Set(MuralDataFormat.Files, [fakeFile] as unknown as FileList);
    const args = buildExternalArgs(data, new Point(30, 40), undefined);
    assert.ok(args !== undefined);
    assert.equal(args.Files.length, 1);
    assert.equal(args.Files[0].name, 'pic.png');
    assert.equal(args.Uris.length, 0);
    assert.equal(args.Position.X, 30);
    assert.equal(args.Position.Y, 40);
});

test('buildExternalArgs parses a text/uri-list payload', () => {
    const data = new DataObject().Set(MuralDataFormat.UriList, 'https://example.com/a\r\nhttps://example.com/b');
    const args = buildExternalArgs(data, new Point(0, 0), undefined);
    assert.ok(args !== undefined);
    assert.deepEqual(args.Uris, ['https://example.com/a', 'https://example.com/b']);
    assert.equal(args.Files.length, 0);
});

test('buildExternalArgs returns undefined when neither files nor uris are present', () => {
    const data = new DataObject().Set('text/plain', 'hello');
    assert.equal(buildExternalArgs(data, new Point(0, 0), undefined), undefined);
});
