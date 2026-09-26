import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FontManager } from '../../../visual-engine/text/font-manager.js';
import '../pragmatic.js'; // importing enrols the theme + registers its fonts block

describe('Pragmatic fonts', () =>
{
    test('the three families are registered offline', () =>
    {
        assert.ok(FontManager.Current.Has('InterTight'),    'Inter Tight registered');
        assert.ok(FontManager.Current.Has('JetBrainsMono'), 'JetBrains Mono registered');
        assert.ok(FontManager.Current.Has('SourceSerif4'),  'Source Serif 4 registered');
    });
});
