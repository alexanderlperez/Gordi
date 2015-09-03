# Gordi.js - Untangle media queries
 Cleaning up media queries filled with styles from unrelated views and pages, mixed together is a laborious process when done by hand.
 Gordi.js takes all the mixed up styles and matches them to the stylesheets that make sense.

 Note: All console output is wrapped in CSS block-comments for easier piping to files. 

 ### Usage
node gordi.js <LESS file> [--print-queries] [--show-unmatched] [--ignore <path>] [--root-glob <glob>]  

Options:  
--print-queries    Print the cherry-picked media queries for each matched file. 
--show-unmatched   Lists all the unmatched styles, and where in the file they are listed 
--ignore <path>    Ignore a file path.  Can be used multiple times.  
--root-glob <glob> Limit searches to patches matching glob  
--verbose          Show errors and extra messages


