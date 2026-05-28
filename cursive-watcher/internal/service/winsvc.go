// Windows service lifecycle for Cursive Watcher.
// On Windows: registers and runs as service named "Cursive Background Helper".
// On Linux/Mac (dev mode): runs as foreground process.

//go:build windows

package service

import (
	"golang.org/x/sys/windows/svc"
)

const ServiceName = "CursiveBackgroundHelper"
const DisplayName = "Cursive Background Helper"

type watcherService struct{ Run func() error }

func (s *watcherService) Execute(args []string, r <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	status <- svc.Status{State: svc.StartPending}
	go s.Run()
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
loop:
	for c := range r {
		switch c.Cmd {
		case svc.Interrogate:
			status <- c.CurrentStatus
		case svc.Stop, svc.Shutdown:
			break loop
		}
	}
	status <- svc.Status{State: svc.StopPending}
	return false, 0
}

func RunAsService(run func() error) error {
	return svc.Run(ServiceName, &watcherService{Run: run})
}
