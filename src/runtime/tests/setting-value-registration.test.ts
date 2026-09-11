import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    MetaData,
    MuralBase,
    type PropertyMetadata,
} from '../index.js';

// SettingValue annotation on PropertyDescriptor.
// Verifies that a property registered with a setting_value arg exposes it
// through descriptor.SettingValue, that omitting the arg yields undefined,
// and that OverrideMetadata without setting_value inherits the parent's.
describe('SettingValue annotation on PropertyDescriptor', () => {

    test('descriptor.SettingValue.key matches the registered key', () => {
        class Host1 extends MuralBase {}

        const key = MuralBase.RegisterProperty<number>(
            Host1, 'SV_WithSetting', 0, MetaData.None,
            undefined, undefined, undefined,
            { key: 'x.y' },
        );
        assert.equal(key.descriptor.SettingValue?.key, 'x.y');
    });

    test('descriptor.SettingValue is undefined when no setting_value arg is supplied', () => {
        class Host2 extends MuralBase {}

        const key = MuralBase.RegisterProperty<number>(
            Host2, 'SV_NoSetting', 0, MetaData.None,
        );
        assert.equal(key.descriptor.SettingValue, undefined);
    });

    test('descriptor.SettingValue exposes an optional convert callback', () => {
        class Host3 extends MuralBase {}

        const convert = (raw: unknown): unknown => Number(raw);
        const key = MuralBase.RegisterProperty<number>(
            Host3, 'SV_WithConvert', 0, MetaData.None,
            undefined, undefined, undefined,
            { key: 'theme.size', convert },
        );
        assert.equal(key.descriptor.SettingValue?.key, 'theme.size');
        assert.equal(key.descriptor.SettingValue?.convert, convert);
    });

    test('subclass OverrideMetadata without setting_value inherits parent SettingValue', () => {
        class Parent extends MuralBase {}
        class Child extends Parent {}

        const key = MuralBase.RegisterProperty<number>(
            Parent, 'SV_Override', 0, MetaData.None,
            undefined, undefined, undefined,
            { key: 'parent.setting' },
        );

        // Override metadata on Child without specifying setting_value —
        // the merge fallback should surface the parent descriptor's value.
        const overrideOpts: PropertyMetadata = { default_value: 42 };
        MuralBase.OverrideMetadata<number>(Child, key, overrideOpts);

        // find_descriptor walks the prototype chain; the Child's bag now has
        // an override descriptor whose parent is the Parent descriptor.
        const childDescriptor = MuralBase.EnumerateProperties(Child)
            .find(d => d.Name === 'SV_Override');
        assert.ok(childDescriptor !== undefined, 'child descriptor must exist');
        assert.equal(childDescriptor.SettingValue?.key, 'parent.setting',
            'inherits setting_value from parent via merge fallback');
    });
});
