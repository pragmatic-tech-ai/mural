// StylesModule — the "Styles & Triggers" demo group as a ShellModule. One capability
// (rail item) backed by StylesService; the group's demo view dictionaries merge here.
import StylesService from "./styles-service.mjs"
import DashboardDemo from "../../demos/dashboard/dashboard.mu.js"

module StylesModule [ Name = "Styles & Triggers" ] {
    .services: {
        StylesService
    }

    resources: {
        merge DashboardDemo
    }

    Capability [ Name = "Styles & Triggers", Icon = @StylesIcon, ServiceKey = StylesService ]
}
