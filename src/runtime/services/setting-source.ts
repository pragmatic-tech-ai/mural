import { Signal } from '@pragmatic-tech-ai/todl-runtime';
import type { PropertyChangedEventArgs } from '@pragmatic-tech-ai/todl-runtime';
import { ServiceKey } from './service-provider.js';

// DI seam through which the EVD setting-value tier (Task 3) reads a
// setting's current value and subscribes to its change signal.
// Implementations are registered against `SettingSourceKey` in the
// application's root ServiceProvider.
export interface ISettingSource
{
    Get(key: string): unknown;
    Changed(key: string): Signal<PropertyChangedEventArgs>;
}

// Typed DI token for the setting-source seam.
export const SettingSourceKey = new ServiceKey<ISettingSource>('SettingSource');
