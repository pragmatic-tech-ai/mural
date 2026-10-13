import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CodeHighlighter } from '../code-highlighter.js';

describe('CodeHighlighter.TokenizeHighlighted', () =>
{
    test('flattens hljs spans into scoped tokens and unescapes text', () =>
    {
        const html = '<span class="hljs-keyword">def</span> f(<span class="hljs-params">x</span>)';
        const toks = CodeHighlighter.TokenizeHighlighted(html);
        assert.deepEqual(toks, [
            { text: 'def', scope: 'keyword' },
            { text: ' f(', scope: undefined },
            { text: 'x', scope: 'params' },
            { text: ')', scope: undefined },
        ]);
    });

    test('innermost scope wins for nested spans', () =>
    {
        const html = '<span class="hljs-string">`a<span class="hljs-subst">${b}</span>c`</span>';
        const toks = CodeHighlighter.TokenizeHighlighted(html);
        assert.deepEqual(toks, [
            { text: '`a', scope: 'string' },
            { text: '${b}', scope: 'subst' },
            { text: 'c`', scope: 'string' },
        ]);
    });

    test('picks the hljs- prefixed class as the primary scope', () =>
    {
        const toks = CodeHighlighter.TokenizeHighlighted('<span class="hljs-title function_">f</span>');
        assert.deepEqual(toks, [{ text: 'f', scope: 'title' }]);
    });

    test('unescapes html entities including & < > " \'', () =>
    {
        const toks = CodeHighlighter.TokenizeHighlighted('a &amp;&lt;&gt;&quot;&#x27; b');
        assert.deepEqual(toks, [{ text: 'a &<>"\' b', scope: undefined }]);
    });

    test('does not double-decode an escaped entity', () =>
    {
        // &amp;lt; is the literal text "&lt;", not a less-than sign.
        const toks = CodeHighlighter.TokenizeHighlighted('&amp;lt;');
        assert.deepEqual(toks, [{ text: '&lt;', scope: undefined }]);
    });
});

describe('CodeHighlighter.Highlight', () =>
{
    test('colours a known language by grammar', () =>
    {
        const toks = CodeHighlighter.Highlight('const x = 1', 'javascript');
        assert.ok(toks.some((t) => t.text.includes('const') && t.scope === 'keyword'));
        assert.ok(toks.some((t) => t.text.trim() === '1' && t.scope === 'number'));
        assert.equal(toks.map((t) => t.text).join(''), 'const x = 1');
    });

    test('preserves newlines for the renderer to split into lines', () =>
    {
        const toks = CodeHighlighter.Highlight('a = 1\nb = 2', 'python');
        assert.equal(toks.map((t) => t.text).join(''), 'a = 1\nb = 2');
    });

    test('auto-detects when no language is given (still round-trips source)', () =>
    {
        const src = 'def greet(name):\n    return "hi " + name';
        const toks = CodeHighlighter.Highlight(src);
        assert.equal(toks.map((t) => t.text).join(''), src);
    });

    test('unknown language degrades to a single plain token', () =>
    {
        const toks = CodeHighlighter.Highlight('plain text here', 'no-such-lang-xyz');
        assert.equal(toks.map((t) => t.text).join(''), 'plain text here');
    });
});

describe('CodeHighlighter.ScopeToToken', () =>
{
    test('maps common scopes onto theme tokens', () =>
    {
        assert.equal(CodeHighlighter.ScopeToToken('keyword'), 'ControlAccent');
        assert.equal(CodeHighlighter.ScopeToToken('string'), 'AccentCyan');
        assert.equal(CodeHighlighter.ScopeToToken('number'), 'AccentPlum');
        assert.equal(CodeHighlighter.ScopeToToken('comment'), 'Fg2');
    });

    test('undefined scope and unknown scopes fall through to default', () =>
    {
        assert.equal(CodeHighlighter.ScopeToToken(undefined), undefined);
        assert.equal(CodeHighlighter.ScopeToToken('totally-unknown'), undefined);
    });
});
