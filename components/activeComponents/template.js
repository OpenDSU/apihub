module.exports = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Active Components</title>
    <style>
        .table {
            display: table;
        }

        .row {
            display: table-row;
        }

        .cell {
            display: table-cell;
            border: 1px solid black;
            padding: 1em;
        }
    </style>
</head>
<body>
$$HEADER
<div class="table">
    <div class="row">
        <div class="cell">TYPE</div>
        <div class="cell">HTTP METHOD</div>
        <div class="cell">PATH [MIDDLEWARE NAME]</div>
        <div class="cell">ACTIVE</div>
    </div>
    $$ACTIVE_COMPONENTS
</div>
</body>
</html>`;