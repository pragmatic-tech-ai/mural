// AnimationsModule — the "Animation" demo group as a ShellModule. One capability
// (rail item) backed by AnimationsService; the group's demo view dictionaries merge here.
import AnimationsService from "./animations-service.mjs"
import AnimationDemo from "../../demos/animation/animation.mu.js"
import AnimationDeclarativeDemo from "../../demos/animation-declarative/animation-declarative.mu.js"
import AnimationNamedDemo from "../../demos/animation-named/animation-named.mu.js"
import AnimationTriggersDemo from "../../demos/animation-triggers/animation-triggers.mu.js"

shell module AnimationsModule [ Name = "Animation" ] {
    .services: {
        AnimationsService
    }

    resources: {
        merge AnimationDemo
        merge AnimationDeclarativeDemo
        merge AnimationNamedDemo
        merge AnimationTriggersDemo
    }

    Capability [ Name = "Animation", Icon = @AnimationIcon, ServiceKey = AnimationsService ]
}
