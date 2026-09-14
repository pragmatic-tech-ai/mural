// help.ts — a framework-level attached property that links a control to a
// help scenario. Authored in markup as `Help.Topic = "<docId>#<anchor>"`.
//
// Mural owns only this primitive (so the compiler can resolve the owner class
// the same way it resolves ThemeManager). The help *content*, overlay behavior,
// and adorners live in the consuming app. The value is opaque to mural: a
// convention string an app-side help system parses.
import { MetaData } from '../runtime/metadata.js';
import { MuralBase } from '../runtime/model.js';
import { Visual } from './visual.js';

export class Help
{
    // Non-inherited: only the tagged control carries the topic. An app-side
    // overlay reads it up the ancestor chain itself, so it is deliberately NOT
    // MetaData.Inherits.
    public static readonly TopicKey = MuralBase.RegisterAttachedProperty<string>(
        Help, 'Topic', '', MetaData.None);

    // Static getters/setters mirror the WPF attached-property API
    // (e.g. `ThemeManager.GetDensity`).
    public static GetTopic(v: Visual): string { return v.get_property_value(Help.TopicKey); }
    public static SetTopic(v: Visual, value: string): void { v.set_property_value(Help.TopicKey, value); }

    // Split "docId#anchor" → parts. Requires a non-empty docId and anchor;
    // returns undefined otherwise so callers can fail silently.
    public static ParseTopic(topic: string): { docId: string; anchor: string } | undefined
    {
        const hash = topic.indexOf('#');
        if (hash <= 0 || hash === topic.length - 1) return undefined;
        return { docId: topic.slice(0, hash), anchor: topic.slice(hash + 1) };
    }
}
