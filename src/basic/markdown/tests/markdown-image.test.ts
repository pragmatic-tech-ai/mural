import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Size } from '../../../runtime/index.js';
import { Image } from '../../index.js';
import { BitmapImage } from '../../../visual-engine/index.js';
import { MarkdownImage, type ImageByteSource } from '../markdown-image.js';

// Minimal in-memory byte source for these tests.
function memStorage(files: Record<string, Uint8Array>): ImageByteSource
{
    return {
        ReadBytes: async (p: string): Promise<Uint8Array> =>
        {
            const f = files[p];
            if (f === undefined) throw new Error(`missing ${p}`);
            return f;
        },
    };
}

describe('MarkdownImage.IsRemoteUri', () =>
{
    test('http/https/data/blob are remote; relative paths are not', () =>
    {
        assert.equal(MarkdownImage.IsRemoteUri('https://x/y.png'), true);
        assert.equal(MarkdownImage.IsRemoteUri('http://x/y.png'), true);
        assert.equal(MarkdownImage.IsRemoteUri('data:image/png;base64,AA'), true);
        assert.equal(MarkdownImage.IsRemoteUri('blob:abc'), true);
        assert.equal(MarkdownImage.IsRemoteUri('./img/a.png'), false);
        assert.equal(MarkdownImage.IsRemoteUri('img/a.png'), false);
    });
});

describe('MarkdownImage.ResolveLocalPath', () =>
{
    test('joins against the base dir', () =>
    {
        assert.equal(MarkdownImage.ResolveLocalPath('docs', 'img/a.png'), 'docs/img/a.png');
        assert.equal(MarkdownImage.ResolveLocalPath('docs', './a.png'), 'docs/a.png');
    });
    test('honours .. and .', () =>
    {
        assert.equal(MarkdownImage.ResolveLocalPath('docs/sub', '../assets/a.png'), 'docs/assets/a.png');
        assert.equal(MarkdownImage.ResolveLocalPath('docs/sub', '../../a.png'), 'a.png');
    });
    test('a leading slash is project-root relative', () =>
    {
        assert.equal(MarkdownImage.ResolveLocalPath('docs/sub', '/assets/a.png'), 'assets/a.png');
    });
    test('strips query and hash', () =>
    {
        assert.equal(MarkdownImage.ResolveLocalPath('docs', 'a.png?v=2#x'), 'docs/a.png');
    });
});

describe('MarkdownImage.MimeForPath', () =>
{
    test('maps common extensions, defaulting to png', () =>
    {
        assert.equal(MarkdownImage.MimeForPath('a.jpg'), 'image/jpeg');
        assert.equal(MarkdownImage.MimeForPath('a.jpeg'), 'image/jpeg');
        assert.equal(MarkdownImage.MimeForPath('a.gif'), 'image/gif');
        assert.equal(MarkdownImage.MimeForPath('a.svg'), 'image/svg+xml');
        assert.equal(MarkdownImage.MimeForPath('a.webp'), 'image/webp');
        assert.equal(MarkdownImage.MimeForPath('a.png'), 'image/png');
        assert.equal(MarkdownImage.MimeForPath('a.unknown'), 'image/png');
    });
});

describe('MarkdownImage.BytesToDataUri', () =>
{
    test('base64-encodes bytes with the mime', () =>
    {
        const uri = MarkdownImage.BytesToDataUri(new Uint8Array([1, 2, 3]), 'image/png');
        assert.equal(uri, 'data:image/png;base64,AQID');
    });
});

describe('MarkdownImage.ResolveUri', () =>
{
    test('remote uris pass through unchanged', async () =>
    {
        const uri = await MarkdownImage.ResolveUri('https://x/y.png', { baseDir: 'docs' });
        assert.equal(uri, 'https://x/y.png');
    });
    test('local paths are read from storage as a data url', async () =>
    {
        const storage = memStorage({ 'docs/img/a.png': new Uint8Array([1, 2, 3]) });
        const uri = await MarkdownImage.ResolveUri('img/a.png', { baseDir: 'docs', storage });
        assert.equal(uri, 'data:image/png;base64,AQID');
    });
    test('a missing local file resolves undefined (no throw)', async () =>
    {
        const storage = memStorage({});
        assert.equal(await MarkdownImage.ResolveUri('nope.png', { baseDir: 'docs', storage }), undefined);
    });
    test('a local path with no storage resolves undefined', async () =>
    {
        assert.equal(await MarkdownImage.ResolveUri('a.png', { baseDir: 'docs' }), undefined);
    });
});

describe('MarkdownImage.LoadInto', () =>
{
    test('sets Image.Source to a BitmapImage at the decoded size', async () =>
    {
        const image = new Image();
        const measure = async (): Promise<Size> => new Size(200, 100);
        await MarkdownImage.LoadInto(image, 'https://x/y.png', { baseDir: '', measure });
        assert.ok(image.Source instanceof BitmapImage);
        assert.equal((image.Source as BitmapImage).Uri, 'https://x/y.png');
        assert.deepEqual(image.Source!.NaturalSize, new Size(200, 100));
    });

    test('scales down oversized images preserving aspect ratio', async () =>
    {
        const image = new Image();
        const measure = async (): Promise<Size> => new Size(1360, 680);   // 2x max width
        await MarkdownImage.LoadInto(image, 'https://x/y.png', { baseDir: '', maxWidth: 680, measure });
        assert.deepEqual(image.Source!.NaturalSize, new Size(680, 340));
    });

    test('leaves Source unset when the size cannot be decoded', async () =>
    {
        const image = new Image();
        const measure = async (): Promise<Size | undefined> => undefined;
        await MarkdownImage.LoadInto(image, 'https://x/y.png', { baseDir: '', measure });
        assert.equal(image.Source, undefined);
    });

    test('inlines a local image from storage before decoding', async () =>
    {
        const image = new Image();
        const storage = memStorage({ 'docs/a.png': new Uint8Array([1, 2, 3]) });
        const measure = async (uri: string): Promise<Size | undefined> => (uri.startsWith('data:') ? new Size(10, 10) : undefined);
        await MarkdownImage.LoadInto(image, 'a.png', { baseDir: 'docs', storage, measure });
        assert.equal((image.Source as BitmapImage).Uri, 'data:image/png;base64,AQID');
        assert.deepEqual(image.Source!.NaturalSize, new Size(10, 10));
    });
});
