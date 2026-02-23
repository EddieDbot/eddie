Run the following bash commands to deploy the latest EDDIE code:

```bash
bash ~/eddie/scripts/git-pull.sh && systemctl --user restart eddie
```

Then wait 3 seconds and show the result:

```bash
sleep 3 && journalctl --user -u eddie --since "5 sec ago" --no-pager | grep -E "EDDIE:init|error" | head -5
```

Report what changed (commits pulled if any) and confirm EDDIE is back up.
