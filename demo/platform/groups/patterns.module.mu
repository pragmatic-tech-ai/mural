// PatternsModule — the "Patterns" demo group as a ShellModule. One capability
// (rail item) backed by PatternsService; the group's demo view dictionaries merge here.
import PatternsService from "./patterns-service.mjs"
import CounterDemo from "../../demos/counter/counter.mu.js"

module PatternsModule [ Name = "Patterns" ] {
    .services: {
        PatternsService
    }

    resources: {
        merge CounterDemo
    }

    Capability [ Name = "Patterns", Icon = @PatternsIcon, ServiceKey = PatternsService ]
}
