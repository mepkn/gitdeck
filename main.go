package main

import (
	"embed"
	"log"
	"time"

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

	// App menu (under "Gitdeck" in the menu bar) with Check for Updates….
	updates := &updater{app: app}
	updates.cleanup()
	appMenu := app.NewMenu()
	appMenu.AddRole(application.About)
	appMenu.Add("Check for Updates…").OnClick(func(*application.Context) { go updates.check(true) })
	appMenu.AddSeparator()
	appMenu.AddRole(application.ServicesMenu)
	appMenu.AddSeparator()
	appMenu.AddRole(application.Hide)
	appMenu.AddRole(application.HideOthers)
	appMenu.AddRole(application.UnHide)
	appMenu.AddSeparator()
	appMenu.AddRole(application.Quit)
	menuBar := app.NewMenu()
	menuBar.AddSubmenu("Gitdeck").Append(appMenu)
	menuBar.AddRole(application.EditMenu)
	menuBar.AddRole(application.ViewMenu)
	menuBar.AddRole(application.WindowMenu)
	app.Menu.Set(menuBar)
	// Quiet check on launch: only says something when there is an update.
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		go func() {
			time.Sleep(3 * time.Second)
			updates.check(false)
		}()
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
