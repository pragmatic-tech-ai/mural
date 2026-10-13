import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Bold, Hyperlink, Italic, LineBreak, Run, Span } from '../../index.js';
import { InlineHtml, HtmlTagKind, type HtmlTag } from '../inline-html.js';

const noop = (): void => {};

describe('InlineHtml.ParseTag', () =>
{
    test('parses open, close, and void forms', () =>
    {
        assert.equal(InlineHtml.ParseTag('<b>')?.kind, HtmlTagKind.Open);
        assert.equal(InlineHtml.ParseTag('<b>')?.name, 'b');
        assert.equal(InlineHtml.ParseTag('</b>')?.kind, HtmlTagKind.Close);
        assert.equal(InlineHtml.ParseTag('<br>')?.kind, HtmlTagKind.Void);
        assert.equal(InlineHtml.ParseTag('<br/>')?.kind, HtmlTagKind.Void);
    });

    test('lower-cases the tag name and reads attributes', () =>
    {
        const tag = InlineHtml.ParseTag('<A HREF="https://x.test" title=\'t\'>') as HtmlTag;
        assert.equal(tag.kind, HtmlTagKind.Open);
        assert.equal(tag.name, 'a');
        assert.equal(tag.attrs['href'], 'https://x.test');
        assert.equal(tag.attrs['title'], 't');
    });

    test('a self-closing whitelisted-looking form is Void', () =>
    {
        assert.equal(InlineHtml.ParseTag('<img src="x"/>')?.kind, HtmlTagKind.Void);
        assert.equal(InlineHtml.ParseTag('<img src="x"/>')?.name, 'img');
    });

    test('returns undefined for non-tags', () =>
    {
        assert.equal(InlineHtml.ParseTag('not a tag'), undefined);
        assert.equal(InlineHtml.ParseTag('< >'), undefined);
    });
});

describe('InlineHtml.IsWhitelistedTag', () =>
{
    test('accepts the whitelist and rejects the rest', () =>
    {
        for (const t of ['b', 'strong', 'i', 'em', 'a', 'code', 'br']) assert.equal(InlineHtml.IsWhitelistedTag(t), true);
        for (const t of ['div', 'span', 'script', 'table']) assert.equal(InlineHtml.IsWhitelistedTag(t), false);
    });
});

describe('InlineHtml.FragmentToInlines', () =>
{
    test('maps <b>/<strong> to Bold with inner text', () =>
    {
        const out = InlineHtml.FragmentToInlines('<b>hi</b>', noop);
        assert.equal(out.length, 1);
        assert.ok(out[0] instanceof Bold);
        assert.ok((out[0] as Bold).Inlines.ToArray()[0] instanceof Run);
        assert.equal(((out[0] as Bold).Inlines.ToArray()[0] as Run).Text, 'hi');
    });

    test('maps <i>/<em> to Italic', () =>
    {
        assert.ok(InlineHtml.FragmentToInlines('<em>x</em>', noop)[0] instanceof Italic);
        assert.ok(InlineHtml.FragmentToInlines('<i>x</i>', noop)[0] instanceof Italic);
    });

    test('maps <a href> to a Hyperlink carrying the uri and click handler', () =>
    {
        let opened: string | undefined;
        const open = (uri: string): void => { opened = uri; };
        const out = InlineHtml.FragmentToInlines('<a href="https://x.test/p">go</a>', open);
        const link = out[0] as Hyperlink;
        assert.ok(link instanceof Hyperlink);
        assert.equal(link.NavigateUri, 'https://x.test/p');
        link.Click?.();
        assert.equal(opened, 'https://x.test/p');
    });

    test('maps <br> to a LineBreak', () =>
    {
        const out = InlineHtml.FragmentToInlines('a<br>b', noop);
        assert.deepEqual(out.map((x) => x.constructor.name), ['Run', 'LineBreak', 'Run']);
        assert.ok(out[1] instanceof LineBreak);
    });

    test('maps <code> to a monospace Span', () =>
    {
        const out = InlineHtml.FragmentToInlines('<code>x=1</code>', noop);
        assert.ok(out[0] instanceof Span);
        assert.ok(/mono/i.test(String((out[0] as Span).FontFamily)));
    });

    test('strips a non-whitelisted tag but keeps its inner text', () =>
    {
        const out = InlineHtml.FragmentToInlines('<div>kept</div>', noop);
        assert.equal(out.length, 1);
        assert.ok(out[0] instanceof Run);
        assert.equal((out[0] as Run).Text, 'kept');
    });

    test('nests whitelisted tags and keeps text through a stripped wrapper', () =>
    {
        const out = InlineHtml.FragmentToInlines('<div>a <b>bold</b> c</div>', noop);
        // stripped <div> flows children into root: Run('a '), Bold, Run(' c')
        assert.deepEqual(out.map((x) => x.constructor.name), ['Run', 'Bold', 'Run']);
        assert.equal((out[0] as Run).Text, 'a ');
        assert.equal(((out[1] as Bold).Inlines.ToArray()[0] as Run).Text, 'bold');
    });

    test('decodes html entities in text', () =>
    {
        const out = InlineHtml.FragmentToInlines('a &amp; b &lt;c&gt;', noop);
        assert.equal((out[0] as Run).Text, 'a & b <c>');
    });
});
