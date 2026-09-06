"""
scripts/train_llama3_unsloth.py
Google Colab / Kaggle Free T4 GPU Fine-Tuning Script for Llama 3.1 8B Instruct using Unsloth & QLoRA.
"""

import sys
import subprocess

# Auto-install unsloth and dependencies if missing in Google Colab
try:
    import unsloth
except ImportError:
    print("📦 Installing Unsloth and dependencies in Google Colab...")
    subprocess.run([sys.executable, "-m", "pip", "install", "--no-deps", "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"], check=True)
    subprocess.run([sys.executable, "-m", "pip", "install", "--no-deps", "trl<0.9.0", "peft", "accelerate", "bitsandbytes"], check=True)
    print("✅ Installation finished!")

import os
from unsloth import FastLanguageModel
import torch
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

max_seq_length = 2048 # Supports long context windows
dtype = None # Auto detection (Float16 for Tesla T4 GPU)
load_in_4bit = True # 4bit quantization reduces VRAM to < 7GB

print("🚀 Loading Llama 3.1 8B Instruct model with 4-bit Unsloth speedups...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "unsloth/llama-3.1-8b-instruct-bnb-4bit",
    max_seq_length = max_seq_length,
    dtype = dtype,
    load_in_4bit = load_in_4bit,
)

print("⚡ Adding QLoRA Adapters for Business Intelligence reasoning...")
model = FastLanguageModel.get_peft_model(
    model,
    r = 16, # LoRA Rank
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj",
                      "gate_proj", "up_proj", "down_proj"],
    lora_alpha = 16,
    lora_dropout = 0, # Optimized 0 dropout for Unsloth
    bias = "none",
    use_gradient_checkpointing = "unsloth",
    random_state = 3407,
)

# Load dataset
dataset_path = "llama3_bi_finetune.jsonl"
if not os.path.exists(dataset_path):
    raise FileNotFoundError(f"Please upload '{dataset_path}' to your Colab root working directory before training!")

dataset = load_dataset("json", data_files=dataset_path, split="train")

# Formatting function to convert conversational JSON messages to Llama-3 Chat Template format
def formatting_prompts_func(examples):
    convs = examples["messages"]
    texts = [tokenizer.apply_chat_template(conv, tokenize=False, add_generation_prompt=False) for conv in convs]
    return { "text" : texts }

dataset = dataset.map(formatting_prompts_func, batched = True)

print("🏋️ Starting SFT Model Training...")
trainer = SFTTrainer(
    model = model,
    tokenizer = tokenizer,
    train_dataset = dataset,
    dataset_text_field = "text",
    formatting_func = formatting_prompts_func,
    max_seq_length = max_seq_length,
    dataset_num_proc = 2,
    packing = False, # Can make training 5x faster for short sequences
    args = TrainingArguments(
        per_device_train_batch_size = 2,
        gradient_accumulation_steps = 4,
        warmup_steps = 5,
        max_steps = 60, # 60 steps takes ~15 mins on a free T4 GPU
        learning_rate = 2e-4,
        fp16 = not torch.cuda.is_bf16_supported(),
        bf16 = torch.cuda.is_bf16_supported(),
        logging_steps = 1,
        optim = "adamw_8bit",
        weight_decay = 0.01,
        lr_scheduler_type = "linear",
        seed = 3407,
        output_dir = "outputs",
    ),
)

trainer_stats = trainer.train()

print("✅ Fine-Tuning Complete! Saving LoRA Adapter...")
model.save_pretrained("llama3_bi_adapter")
tokenizer.save_pretrained("llama3_bi_adapter")

print("🎉 Model saved to 'llama3_bi_adapter/' directory.")
print("To upload to your free Hugging Face account:")
print("  model.push_to_hub_merged('YOUR_HF_USERNAME/llama3-bi-adapter', tokenizer, save_method='lora', token='YOUR_HF_TOKEN')")
