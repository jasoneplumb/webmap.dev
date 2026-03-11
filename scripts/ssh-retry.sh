#!/bin/bash

# ssh_retry: Retry wrapper for SSH/SCP commands with exponential backoff.
# 3 attempts with delays of 5s, 15s, 30s between failures.
# Uses bash -c instead of eval for safety (inputs are workflow-controlled, not user-controlled).
#
# Usage:
#   source scripts/ssh-retry.sh
#   ssh_retry "scp $SSH_OPTS file user@host:/path"
#   ssh_retry "ssh $SSH_OPTS user@host 'command'"
ssh_retry() {
  local attempt=1
  local delays=(5 15 30)
  while [ $attempt -le 3 ]; do
    echo "SSH attempt $attempt/3..."
    if bash -c "$1"; then
      return 0
    fi
    if [ $attempt -lt 3 ]; then
      echo "SSH failed, retrying in ${delays[$((attempt-1))]}s..."
      sleep "${delays[$((attempt-1))]}"
    fi
    attempt=$((attempt + 1))
  done
  echo "SSH failed after 3 attempts"
  return 1
}
