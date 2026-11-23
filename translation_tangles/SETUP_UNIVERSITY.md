# Running the big models on a university GPU

## 1. Check the machine (paste the output of this to the chat)
    nvidia-smi --query-gpu=name,memory.total --format=csv
    df -h .                      # need >= 150 GB free for 3 model downloads
    python3 --version            # 3.10+
    curl -sI https://huggingface.co | head -1     # should say 200 or 301/302, not an error
    which tmux screen            # to keep a job running after you disconnect

## 2. One-time setup
    git clone <your repo> && cd <repo>/translation_tangles     # or copy the translation_tangles folder
    python3 -m venv venv && source venv/bin/activate
    pip install vllm==0.33.0 huggingface_hub sacrebleu   # 0.34.0 crashes in warmup on some setups
    export HF_TOKEN=<your HuggingFace token>                   # not in any file, not in the chat
    unzip tt_data.zip -d tt_data                               # so that tt_data/manifest.json exists

## 3. Run (inside tmux, so it survives a disconnect)
    tmux new -s tt
    python tools/run_queue.py llama-3.1-70b llama3-70b llama-3.3-70b
    # detach: Ctrl-b then d.   Re-attach later: tmux attach -t tt

Check `logs/<model>.log`; when a model finishes, `work/outputs_<model>.zip` appears. Send the zips to the chat.
If the queue stops, run the same command again: finished directions are skipped.

## Order of priority
1. llama-3.1-70b (general benchmark, Table 1 large group, bias heatmap)
2. llama3-70b (same)
3. llama-3.3-70b (domains)
4. only with an 80 GB GPU and working 4-bit weights: llama-3.2-90b-vision, deepseek-r1-distill-70b
