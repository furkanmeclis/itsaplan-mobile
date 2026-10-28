# It's a Plan Mobile

An open-source, multi-server mobile companion for [It's a Plan](https://github.com/croffasia/itsaplan).

**Selected design: 01 / Sakin, with configurable theme colors.** The native application foundation is in progress. The HTML prototype contains sample data and makes no server connections.

## Design review

Download [the standalone HTML prototype](design/tasarim-secimi.html) and open it in a browser. It has no external dependencies and works offline.

| Direction | Appearance | Focus |
| --- | --- | --- |
| 01 / Sakin | Light surfaces, green accents, rounded cards | Calm daily task management |
| 02 / Gece | Dark surfaces, lavender accents, compact lists | Focused work for technical teams |
| 03 / Atölye | Cream surfaces, orange accents, serif headings | A warm editorial identity |

Use the top controls to compare tasks, notifications, and servers. Each phone also has its own navigation. Open task cards, switch accounts, add a sample server, or mark sample tasks complete. The selection button only records a choice in the page until reload; it does not submit feedback. The user selected 01 / Sakin. The choice and subsequent decisions are recorded in It’s a Plan project `technowide-software.IPM`.

![Three mobile design directions](design/preview-tasks.png)

## Scope

- Android and iOS application with isolated accounts for multiple self-hosted servers.
- Projects, assigned tasks, task details, and comments.
- An inbox that identifies each notification's source server and account.
- A server notification integration and an independently deployable push gateway.

See [the project brief](docs/project-brief.md), [delivery process](CONTRIBUTING.md), and [project tracking](docs/tracking.md).

## CI

The initial `Design preview` workflow packages the standalone HTML and screenshots as a downloadable artifact on pull requests, pushes to `main`, and manual runs. It requires no secrets.

Android APK and iOS simulator build workflows will be added with the Expo application. There is no native application build in this initial design PR.

## License

AGPL-3.0-only. This is an independent companion project and is not an official release of the upstream project. No upstream application code has been copied into this prototype.
