import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Signal, ServiceProvider } from '@pragmatic-tech-ai/todl-runtime';
import type { PropertyChangedEventArgs } from '@pragmatic-tech-ai/todl-runtime';
import { type ISettingSource, SettingSourceKey } from '../setting-source.js';
import { readServiceScope } from '../../binding/service-scope.js';
import { Element } from '../../../visual-engine/element.js';

// A minimal ISettingSource fake for DI tests.
class FakeSettingSource implements ISettingSource
{
    private readonly _store = new Map<string, unknown>();
    private readonly _signals = new Map<string, Signal<PropertyChangedEventArgs>>();

    public set(key: string, value: unknown): void
    {
        this._store.set(key, value);
    }

    public Get(key: string): unknown
    {
        return this._store.get(key);
    }

    public Changed(key: string): Signal<PropertyChangedEventArgs>
    {
        let sig = this._signals.get(key);
        if (sig === undefined)
        {
            sig = new Signal<PropertyChangedEventArgs>();
            this._signals.set(key, sig);
        }
        return sig;
    }

    public fire(key: string, args: PropertyChangedEventArgs): void
    {
        this._signals.get(key)?.emit(args);
    }
}

describe('ISettingSource + SettingSourceKey — DI registration', () =>
{
    test('provider.get(SettingSourceKey) returns the registered implementation', () =>
    {
        const fake = new FakeSettingSource();
        const provider = new ServiceProvider();
        provider.registerInstance(SettingSourceKey, fake);

        const resolved = provider.get(SettingSourceKey);
        assert.strictEqual(resolved, fake);
    });

    test('Get returns the value stored in the fake', () =>
    {
        const fake = new FakeSettingSource();
        fake.set('theme', 'dark');

        const provider = new ServiceProvider();
        provider.registerInstance(SettingSourceKey, fake);

        const src = provider.get(SettingSourceKey)!;
        assert.strictEqual(src.Get('theme'), 'dark');
        assert.strictEqual(src.Get('missing'), undefined);
    });

    test('Changed returns a Signal that fires subscribed handlers', () =>
    {
        const fake = new FakeSettingSource();
        const provider = new ServiceProvider();
        provider.registerInstance(SettingSourceKey, fake);

        const src = provider.get(SettingSourceKey)!;
        let fired = false;
        const sub = src.Changed('density').subscribe(() => { fired = true; });

        fake.fire('density', { owner: fake as unknown as object, propertyName: 'density' } as PropertyChangedEventArgs);
        assert.strictEqual(fired, true);

        sub.dispose();
    });
});

describe('readServiceScope', () =>
{
    test('returns the provider set as ServiceScope on an Element', () =>
    {
        const provider = new ServiceProvider();
        const el = new Element();
        el.ServiceScope = provider;

        const resolved = readServiceScope(el);
        assert.strictEqual(resolved, provider);
    });

    test('returns undefined when no ServiceScope is set', () =>
    {
        const el = new Element();
        const resolved = readServiceScope(el);
        assert.strictEqual(resolved, undefined);
    });
});
