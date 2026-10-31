# Windows Client Reference

Load this reference only when Windows packaging or process behavior changes the result. Resolve the project's platform contract first.

## Installer Boundary

Prefer current-user installation when the client owns no Service, driver, machine-wide shared resource, or privileged prerequisite. Use machine-wide installation only for a verified platform requirement. The selected installer owns first install, repair, upgrade, uninstall, shortcuts, registration, and platform prerequisites; the launcher owns runtime preparation and application session lifecycle.

For MSI repair or upgrade, start one setup flow after installation finalization. Preserve one registration, user settings, and product data. Distinguish in-place upgrade replacement from final uninstall cleanup; do not remove runtime or user-owned state merely because an older installer process has exited.

## Hidden Process And Takeover

Run package-manager, helper, installer, shell, and runtime processes from the backend or launcher with the runtime's documented no-console/window flags. Keep argument boundaries, cancellation, bounded output, exit codes, and process-tree cleanup observable. A hidden process requirement is not satisfied by checking only a debug build.

When taking over an existing installation, identify processes by verified executable path inside the product installation root. Request normal shutdown first, show a waiting state, and use force termination only at the contract's explicit boundary. Never terminate reused system components or unrelated processes.

## WebView2 And Desktop Web

Treat WebView2 as a platform prerequisite owned by Microsoft and the installer/framework integration. Probe and repair it through the supported platform path, then re-probe. If another product owns the web surface, load that business surface without a duplicate page or route. Preserve the native host's project-owned loading, error, update and recovery feedback; those controls must not take over business state or interactions.

## Windows Acceptance

Verify the exact generated installer and installed executable for affected behavior: registration, shortcut target, repair/repeat install, upgrade state preservation, final uninstall boundary, terminal/window behavior and owned-process cleanup. Select cases from the change and existing acceptance requirements. A focused install check may require a clean environment while remaining Development; an independent clean-machine candidate campaign requires the user's request.
