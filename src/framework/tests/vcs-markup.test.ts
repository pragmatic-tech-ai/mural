import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instantiate } from '../../compiler/compile.js';
import * as runtime from '../../runtime/index.js';
import * as controls from '../../basic/index.js';
import * as engine from '../../visual-engine/index.js';
import { VisualContext, VisualContextScope } from '../index.js';

const CTX = { ...runtime, ...controls, ...engine, VisualContext, VisualContextScope };

test('VisualContextScope.Context attached-property setter compiles + applies in markup', () => {
    const factory = instantiate('Border [ VisualContextScope.Context = VisualContext.Tile ]', CTX) as () => any;
    const b = factory();
    assert.equal(VisualContextScope.GetContext(b), VisualContext.Tile);
});
