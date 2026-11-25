import { slideVars } from "https://esm.sh/@codepen/slidevars";

let select = e => document.querySelector(e);
let selectAll = e => document.querySelectorAll(e);

const
foreground = select("#foreground"),
paperCuts = selectAll("#foreground li");

/* color editor */
var slideVarsArray = {
    "--color1": { type: "color", default: "#FFFFFF" },
    "--color2": { type: "color", default: "#A2C001" }
};
slideVars.init( slideVarsArray, { defaultOpen: false });

/* is the browser css random() enabled */
let randomEnabled = false;
if ( window.getComputedStyle(foreground).getPropertyValue("offset-distance") !== "50%" )
    randomEnabled = true;
else
{

    paperCuts.forEach((cut, i) => {    
        let rotate = Math.floor(Math.random() * 360 );
        cut.style.setProperty("--rotate", `rotate(${rotate}deg)`);
    });

}