; Installer Windows (perMachine, jadi berjalan sebagai admin): buka port 8013 di firewall supaya
; mesin absensi di jaringan lokal bisa mengirim ke aplikasi ini. Dihapus lagi saat uninstall.
!macro NSIS_HOOK_POSTINSTALL
  nsExec::Exec 'netsh advfirewall firewall delete rule name=FreedomFingerApp'
  nsExec::Exec 'netsh advfirewall firewall add rule name=FreedomFingerApp dir=in action=allow protocol=TCP localport=8013 remoteip=localsubnet'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::Exec 'netsh advfirewall firewall delete rule name=FreedomFingerApp'
!macroend
