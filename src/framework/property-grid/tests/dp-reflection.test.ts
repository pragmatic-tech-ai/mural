import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { MuralBase, MetaData, PropertyKey } from '../../../runtime/index.js';

class Probe extends MuralBase {
  static readonly LabelKey = MuralBase.RegisterProperty<string>(Probe, 'Label', 'init', MetaData.None);
  get Label(): string { return this.get_property_value(Probe.LabelKey); }
  set Label(v: string) { this.set_property_value(Probe.LabelKey, v); }
}

describe('DP reflection — reconstructed PropertyKey', () => {
  beforeEach(() => { initTestApp(); });
  test('get/set by a key rebuilt from EnumerateProperties round-trips', () => {
    const p = new Probe();
    const d = MuralBase.EnumerateProperties(Probe).find((x) => x.Name === 'Label')!;
    const key = new PropertyKey(d);
    assert.equal(p.get_property_value(key), 'init');   // reads default
    p.set_property_value(key, 'edited');
    assert.equal(p.Label, 'edited');                    // wrote through to the instance
  });
});
