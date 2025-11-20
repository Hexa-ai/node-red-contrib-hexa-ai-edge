@hexa-ai/node-red-contrib-hexa-ai-edge
=====================

Retrieves and aggregates historical data from the SQLite DataPlug database.

## Install

Run the following command in your Node-RED user directory - typically `~/.node-red`

        npm install node-red-contrib-dataplug

## Information

# DataPlug History

This subflow retrieves historical time-series data from a partitioned SQLite database and allows for configurable aggregation.

### Features

-   **Handles Time-Based Partitions**: Automatically queries the correct monthly data tables.
-   **Data Enrichment**: Attaches the correct measurement **unit**, **description**, and **category** from a `var` table.
-   **Flexible Time Range**: Supports dynamic (via `msg.payload`) and static (via node properties) time ranges.
-   **Configurable Aggregation**: Allows selecting the aggregation function (Average, Min, Max, Difference), time interval, raw data, or the last recorded value.
-   **Advanced Category Filtering**: If a category is selected, it will filter the results to only include channels within that category.

### Configuration

-   **`Default time range`**: Sets the time period to query.
-   **`Aggregation Function`**: Sets the SQL function for aggregation. 
-   **`Aggregation Interval`**: Sets the time window for grouping data. Select "None" for raw data or "Last Value Only" for the most recent point.
-   **`Filter by Category`**: A dropdown to select a category to filter by.

### Inputs

-   `channels` (Array, Optional): An array of channel names.
-   `from` (Number, Optional): Start timestamp in milliseconds.
-   `to` (Number, Optional): End timestamp in milliseconds.

### Outputs

-   `msg.payload` (Object): A single object where each key is a channel name. Each channel object contains `min`, `max`, `unit`, `description`, `category`, `start_time`, `end_time`, and an array of `records`.
