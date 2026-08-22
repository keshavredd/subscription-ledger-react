import os
import sys
import urllib.request
import duckdb

# Set stdout encoding to UTF-8 for Windows console
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

URLS = {
    "subscription": "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=598826199",
    "funnel": "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1049115614",
    "realtime": "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/export?format=csv&gid=1333104452",
    "renewals": "https://docs.google.com/spreadsheets/d/1V4-r-cRynpjttGvmLfT2iSx7D3jFnuAMsJyXonPKlEE/gviz/tq?tqx=out:csv&sheet=renewal_raw"
}

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)

conn = duckdb.connect(database=':memory:')

print("=== Starting Google Sheets to Parquet Conversion ===")

for key, url in URLS.items():
    print(f"\n[+] Fetching {key} dataset from Google Sheets...")
    temp_csv = os.path.join(OUTPUT_DIR, f"temp_{key}.csv")
    parquet_file = os.path.join(OUTPUT_DIR, f"{key}.parquet")

    temp_csv_clean = temp_csv.replace('\\', '/')
    parquet_file_clean = parquet_file.replace('\\', '/')

    try:
        # Download raw CSV
        urllib.request.urlretrieve(url, temp_csv)
        csv_size = os.path.getsize(temp_csv) / 1024.0

        # Read CSV into DuckDB in-memory table and export to Parquet with Snappy compression
        conn.execute(f"CREATE OR REPLACE TABLE {key} AS SELECT * FROM read_csv_auto('{temp_csv_clean}', header=True, ignore_errors=True)")
        conn.execute(f"COPY {key} TO '{parquet_file_clean}' (FORMAT PARQUET, COMPRESSION 'SNAPPY')")

        parquet_size = os.path.getsize(parquet_file) / 1024.0
        row_count = conn.execute(f"SELECT COUNT(*) FROM {key}").fetchone()[0]

        compression_ratio = ((csv_size - parquet_size) / csv_size) * 100 if csv_size > 0 else 0
        print(f"    OK Processed {row_count:,} rows")
        print(f"    OK Raw CSV size:     {csv_size:,.1f} KB")
        print(f"    OK Parquet size:     {parquet_size:,.1f} KB")
        print(f"    ⚡ Compression:     {compression_ratio:.1f}% reduction!")

        # Clean up temporary CSV
        if os.path.exists(temp_csv):
            os.remove(temp_csv)

    except Exception as e:
        print(f"    [!] Error converting {key}: {e}")

print("\n=== All datasets successfully converted to compressed Parquet! ===")
