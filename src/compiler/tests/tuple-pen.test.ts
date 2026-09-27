import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compile, EmitError } from '../compile.js';

// Wave-1 follow-up (A): a parenthesized 2-cell tuple assigned to a
// Pen-typed DP (Visual.Stroke, Diagram.SelectionFormatStroke, …) must
// compile to `new Pen(brush, thickness)`, not fall into the default
// Thickness/CornerRadius tuple shape (which silently produced a
// Thickness that nothing ever painted — see PEN_PROPERTIES in
// symbol-table.ts and the isPenTarget branch in compileTupleValue).

function emitted(src: string): string
{
    return compile(src).js;
}

describe('compile — tuple-form Stroke compiles to Pen', () => {
    test('Style setter: Stroke = (@Token, n) emits new Pen(...), not new Thickness(...)', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style[TargetType=Border]{
                        Stroke = (@outlineBrush, 2);
                    }
                }
            }
        `);
        assert.match(js, /new Pen\(/);
        assert.doesNotMatch(js, /new Thickness\(/);
    });

    test('when(...) trigger setter: Stroke = (@Token, n) emits new Pen(...), not new Thickness(...)', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style[TargetType=Border]{
                        when( IsMouseOver ){
                            Stroke = (@outlineBrush, 3);
                        }
                    }
                }
            }
        `);
        assert.match(js, /new Pen\(/);
        assert.doesNotMatch(js, /new Thickness\(/);
    });

    test('direct attribute: Stroke = (@Token, n) emits new Pen(...) too', () => {
        const js = emitted(`
            Application{
                resources: {
                    Border x:root[Stroke=(@outlineBrush, 2)]{}
                }
            }
        `);
        assert.match(js, /new Pen\(/);
        assert.doesNotMatch(js, /new Thickness\(/);
    });

    test('Stroke tuple with 3 cells throws a clear EmitError (Pen has no 1-/4-arg fill-in)', () => {
        assert.throws(
            () => emitted(`
                Application{
                    resources: {
                        Style[TargetType=Border]{
                            Stroke = (@a, @b, @c);
                        }
                    }
                }
            `),
            (err: unknown) => err instanceof EmitError
                && /Pen shape/.test((err as Error).message)
                && /exactly 2 cells/.test((err as Error).message),
        );
    });
});
