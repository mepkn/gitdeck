package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"gitdeck/internal/shellenv"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Finder starts apps with a bare PATH; git's helpers and the agent CLIs
	// live on the login shell's.
	shellenv.Load()

	gitdeck, err := NewGitdeck()
	if err != nil {
		log.Fatal(err)
	}

	app := application.New(application.Options{
		Name:        "Gitdeck",
		Description: "Git client for your projects, with VS Code-style diffs",
		Services: []application.Service{
			application.NewService(gitdeck),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "Gitdeck",
		Width:     1360,
		Height:    860,
		MinWidth:  900,
		MinHeight: 560,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 48,
			Backdrop:                application.MacBackdropNormal,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(23, 23, 28),
		URL:              "/",
	})

	gitdeck.onOpen = func() {
		window.Show()
		window.Focus()
	}
	// gitdeck://open?path=... from agentdeck, also when it starts the app.
	app.Event.OnApplicationEvent(events.Common.ApplicationLaunchedWithUrl, func(e *application.ApplicationEvent) {
		gitdeck.HandleURL(e.Context().URL())
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
