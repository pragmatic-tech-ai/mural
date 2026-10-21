import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../compile.js';

class TupleTokenBindingFixture
{
    public static Emit(src: string): string
    {
        return compile(src).js;
    }

    public static Wrap(attrs: string): string
    {
        return `Border [ ${attrs} ] {}`;
    }
}

describe('compile — token-bearing tuples lower to a live composite binding', () => {
    test('Padding = (@FocusRingOffset) lowers to a composite, not eager TryFindResource', () => {
        const js = TupleTokenBindingFixture.Emit(TupleTokenBindingFixture.Wrap('Padding = (@FocusRingOffset)'));
        assert.match(js, /DynamicResourceComposite\(/);
        assert.match(js, /new TokenCell\("FocusRingOffset"\)/);
        assert.match(js, /\(v\) => new Thickness\(\.\.\.v\)/);
        assert.doesNotMatch(js, /TryFindResource\("FocusRingOffset"\)/);
        assert.match(js, /import \{[^}]*DynamicResourceComposite[^}]*\} from "@pragmatic-tech-ai\/mural\/runtime"/);
        assert.match(js, /import \{[^}]*TokenCell[^}]*\} from "@pragmatic-tech-ai\/mural\/runtime"/);
    });

    test('all-numeric tuple stays a plain Thickness (no composite)', () => {
        const js = TupleTokenBindingFixture.Emit(TupleTokenBindingFixture.Wrap('Padding = (16, 8, 16, 8)'));
        assert.match(js, /new Thickness\(16, 8, 16, 8\)/);
        assert.doesNotMatch(js, /DynamicResourceComposite\(/);
    });

    test('CornerRadius token tuple lowers to a composite building a CornerRadius', () => {
        const js = TupleTokenBindingFixture.Emit(TupleTokenBindingFixture.Wrap('CornerRadius = (@Space1)'));
        assert.match(js, /DynamicResourceComposite\(/);
        assert.match(js, /\(v\) => new CornerRadius\(\.\.\.v\)/);
    });

    test('two-cell tuple expands WPF-style and keeps numeric literals raw', () => {
        const js = TupleTokenBindingFixture.Emit(TupleTokenBindingFixture.Wrap('Padding = (@Space1, 4)'));
        assert.match(js, /\[new TokenCell\("Space1"\), 4, new TokenCell\("Space1"\), 4\]/);
    });

    test('a tuple mixing a local @resource and a scheme token keeps the local as its var', () => {
        const js = TupleTokenBindingFixture.Emit(`
            resources Test {
                Style x:key="Pad" [TargetType=Border] { Padding = (1); }
                Border x:key="B" [ Padding = (@Pad, @Space1, @Pad, @Space1) ]
            }
        `);
        assert.match(js, /new TokenCell\("Space1"\)/);
        assert.doesNotMatch(js, /new TokenCell\("Pad"\)/);
    });
});
