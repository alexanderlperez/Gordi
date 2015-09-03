/**
  * # Gordi.js - Untangle media queries
  *  Cleaning up media queries filled with styles from unrelated views and pages, mixed together is a laborious process when done by hand.
  *  Gordi.js takes all the mixed up styles and matches them to the stylesheets that make sense.

  *  Note: All console output is wrapped in CSS block-comments for easier piping to files. 

  *  ### Usage
    node gordi.js <LESS file> [--print-queries] [--show-unmatched] [--ignore <path>] [--root-glob <glob>]  

    Options:  
    --print-queries    Print the cherry-picked media queries for each matched file. 
    --show-unmatched   Lists all the unmatched styles, and where in the file they are listed 
    --ignore <path>    Ignore a file path.  Can be used multiple times.  
    --root-glob <glob> Limit searches to patches matching glob  
    --verbose          Show errors and extra messages

 */

var css = require('css');
var fs = require('fs');
var execFile = require('child_process').execFile;
var _ = require('lodash');
var execQueue = require('exec-queue');
var chalk = require('chalk');
var argv = require('minimist')(process.argv.slice(2));

// ### Initialization

function showCliHelp() {
    console.log(
        "\nGordi.js -- Untangle media queries\n\n" + 
        "Cleaning up media queries filled with styles from unrelated views and pages, mixed together is a laborious process when done by hand." + 
        "Gordi.js takes all the mixed up styles and matches them to the stylesheets that make sense.\n\n" + 
        "Note: All console output is wrapped in CSS block-comments for easier piping to files.\n\n" + 
        "Usage:\n" + 
        "node gordi.js <LESS file> [--print-queries] [--show-unmatched] [--ignore <path>] [--root-glob <glob>] \n\n" + 
        "Options:\n" + 
        "--print-queries    Print the cherry-picked media queries for each matched file. \n" +
        "--show-unmatched   Lists all the unmatched styles, and where in the file they are listed \n" +
        "--ignore <path>    Ignore a file path.  Can be used multiple times.  \n" +
        "--root-glob <glob> Limit searches to patches matching glob  \n" +
        "--verbose          Show errors and extra messages\n" 
    );
}

// The minimist library is used to gather and process all the command-line arguments
var INPUT_FILE = argv._[0]; // <= get the first argument w/ minimist
if (_.isUndefined(INPUT_FILE)) {
    console.log('Error: include a file path as an argument');
    showCliHelp();
    return;
}
if (!fs.existsSync(INPUT_FILE)) {
    console.log("Error: file doesn't exist");
    showCliHelp();
    return;
}

var IGNORE_LIST = [].concat(INPUT_FILE, argv.ignore);

var parsedCss;
var queryRules = [];
var singleRules = []; 
var filesData = { 
    unknown: [] 
};


// ### Model factories/Schema

// #### Generic, bare-minimum, Rework-stringifiable AST.
function createRuleAST(rule) {
    return {
        stylesheet: {
            rules: [
                rule
            ]
        }
    };
};

// #### Rework-stringifiable @media AST
function createMediaAST(queryString) {
    return {
        stylesheet: { 
            rules: [
                {
                    type: 'media',
                    media: queryString,
                    rules: [],
                    position: {},
                    parent: {}
                }
            ]
        }
    };
};

// #### Intermediate object
//
// The intermediate object makes it simpler follow the process of parsing and 
// transforming (or munging) the CSS data.
function generateRule(rule, AST, media) {
    return {
        class: undefined,
        rule: rule,
        AST: AST,
        media: media
    };
}


// ## Analysis

console.log(chalk.green('/* Analysing:', INPUT_FILE, ' */\n'));

// Parse all the media queries in the file and save them to queryRules.
// This makes sure we've got all our variables, mixins, and extends processed
execFile('lessc', [INPUT_FILE], function (error, stdout) {
    if (error) {
        console.error(chalk.red('Compiling failed'), error);
        return; 
    }

    parsedCss = css.parse(stdout);

    // ### Pre-Parsing
    // gordi.js only concerns itself with @media css-blocks, so we'll be ignoring everything else.
    parsedCss.stylesheet.rules.forEach(function (parsedRule) {
        if (parsedRule.type === "media") {
            parsedRule.rules.forEach(function (rule) { 
                var ruleData = generateRule(rule, createRuleAST(rule), rule.parent.media);
                queryRules.push(ruleData);
            });
        }
    });

    /*
    * To simplify the processing, all the styles/rules will be broken up into single selectors. For the following,
    * take a rule with potentially many selectors, and duplicate the rule per selector, the output generates a schema
    * like this one:
    *
    * <pre>
    *
    *     {
    *         class: undefined,
    *         rule: rule,
    *         AST: AST,
    *         media: media
    *     }
    *
    * </pre>
    */
    
    queryRules.forEach(function (rule) {
        rule.rule.selectors.forEach(function (selector, index) {
            var newRule = _.cloneDeep(rule);
            newRule['class'] = selector;
            singleRules.push(newRule);
        });
    });

    /* ### Cherry-picking media
     * The next step is to find where all the styles originated.  For every style, find the file which best matches 
     * the origin of the style.
     */
    singleRules.forEach(function (rule, idx) {
        var selector = rule.class.split(' ')[0]; // simply the first classname
        var command = 'git grep -F ' + selector + (argv['root-glob'] ? argv['root-glob'] : ''); // run 'git grep' on the selector,

        // This uses the exec-queue version of exec, which queues up the commands by 10 to prevent ulimit errors
        execQueue(command, { maxBuffer: 1024 * 500 }, function (error, stdout, stderr) {
            if (error) {
                if (argv.verbose) {
                    console.log("/* Can't find", selector, ' using:', command, ':', error, ' */');
                }
                return;
            }

            // Parse the results, ignoring the input file path.
            // Attempt to get the unique LESS file, that is not the input file, parsed from grep's output

            rule['files'] = _(stdout.split('\n'))
                .compact() // remove empty values
                .map(function (string) { if (string.length > 0) return string.split(':')[0] })
                .filter(function (path) { return !_.includes(IGNORE_LIST, path); }) // skip all the files in the IGNORE_LIST
                .filter(function (path) {   // test that the last string split by '.' is 'less'
                    var splitPath = path.split('.');
                    var extension = splitPath[splitPath.length - 1];
                    return extension === 'less';
                })
                .uniq()
                .value()

           /*
            * Process single rules into filesData object, making collections per filename,
            * except if the rule has more than one file, which would put it in the 'other' collection.
            * Munge each rule into filesData according to the schema:
            *
            * <pre>
            *
            *     {
            *         "file path": {
            *             mediaQueries: {
            *                 "query": [ style objects ]
            *             }
            *         }
            *     }
            *
            * </pre>
            */
                
            // So our media queries aren't filled with unrelated rules, only munge rules with 
            // identified origins, ie. rules with only one filename if for some reason a rule 
            // without an origin is found, put it in unknown as well.

            if (rule.files.length !== 1) {
                filesData.unknown.push(rule);
                return;
            }

            // Create new data if needed, insert if not, ie. :
            // 1. Test file entry exists
            // 2. Test media query entry exists
            
            var file = rule.files[0];
            var query = rule.media;
            if (!filesData[file]) {
                filesData[file] = {
                    mediaQueries: {}
                };
            }
            if (!filesData[file].mediaQueries[query]) {
                filesData[file].mediaQueries[query] = [];
            }

            // Put the real Rework CSS 'rule' AST in the mediaQueries array
            filesData[file].mediaQueries[query].push(rule.rule);

            // ## Creating the output
            // Only move on after the last rule has been processed into filesData.
            if (idx === singleRules.length - 1) {

                // After the last rule, process the rules and make all the file reports, a la:
                //
                // <pre>
                // "file path":
                //  "media query" {
                //      "style 1" {
                //      }
                //      ...
                //      "style n" {
                //      }
                //  }
                //  </pre>
                //
                //  ...Repeat for all files, all queries
            
                // The idea here is to create an easibly css.stringify'able object by:
                // 1. getting the filesData entry and the media query being worked on
                // 2. creating a new AST entry of type 'media' 
                // 3. appending all the rules related to that query's collection correctly in the 'rules' array

                Object.keys(filesData).forEach(function (path, idx) {
                    if (path === 'unknown') {
                        return;
                    }

                    var file = filesData[path];

                    file.astList = [];  // This list will get filled with proper media query ASTs

                    // Go through all the mediaQueries and grab the rules to add to the astList
                    // Essentially, all the previous data is scratch data, and astList is full of
                    // proper ASTs of @media queries, populated with proper ASTs of CSS rules

                    Object.keys(file.mediaQueries).forEach(function (query) {

                        // This is how the resulting object should look:
                        // 
                        // <pre>
                        //
                        //    astList: [
                        //        {
                        //            stylesheet: {
                        //                rules: [ 
                        //                    {
                        //                        type: 'media',
                        //                        media: "query string",
                        //                        rules: [ { styling rules } ]
                        //                    },
                        //                    ...
                        //                ]
                        //            }
                        //        },
                        //        ...
                        //    ]
                        //
                        // </pre>

                        // Create stringifiable AST object
                        var queryAST = createMediaAST(query);
                        queryAST.stylesheet.rules[0].type = 'media';
                        queryAST.stylesheet.rules[0].media = query;
                        queryAST.stylesheet.rules[0].rules = file.mediaQueries[query];
                        file.astList.push(queryAST);
                    });
                });

                // Pretty-print the matched queries and styles.
                // The default is to show just the files, unless the 
                // app is run with the `--print-queries` argument
                Object.keys(filesData).forEach(function (file) {
                    if (file === 'unknown') {
                        return;
                    }

                    console.log(chalk.blue('/* Origin file:' + file + ' */'));
                    if (argv['print-queries']) {
                        filesData[file].astList.forEach(function (ast) {
                            var string = css.stringify(ast);
                            console.log(string);
                        });
                    }
                    console.log(''); // newline
                });

                // Print all the unmatched styles
                if (argv['show-unmatched']) {
                    console.log(chalk.yellow('/* Showing unmatched styles */'));
                    filesData.unknown.forEach(function (rule) {
                        console.log('\n/*', INPUT_FILE, 'Line:', rule.rule.position.start.line, '*/');
                        console.log(css.stringify(rule.AST));
                    });
                }
            }
        });
    });
});
