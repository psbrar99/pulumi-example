import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";


const config = new pulumi.Config();
let keyName: pulumi.Input<string> | undefined = config.get("keyName");
const publicKey = config.get("publicKey");

const vpc = new awsx.ec2.Vpc("vpc")

// // Create an an internet gateway.
// const gateway = new aws.ec2.InternetGateway("gateway", {
//     vpcId: vpc.id,
// });

// // Create a subnet that automatically assigns new instances a public IP address.
// const subnet = new aws.ec2.Subnet("subnet", {
//     vpcId: vpc.id,
//     cidrBlock: "10.0.1.0/24",
//     mapPublicIpOnLaunch: true,
// });

// // Create a route table.
// const routes = new aws.ec2.RouteTable("routes", {
//     vpcId: vpc.id,
//     routes: [
//         {
//             cidrBlock: "0.0.0.0/0",
//             gatewayId: gateway.id,
//         },
//     ],
// });

// // Associate the route table with the public subnet.
// const routeTableAssociation = new aws.ec2.RouteTableAssociation("route-table-association", {
//     subnetId: subnet.id,
//     routeTableId: routes.id,
// });

if (!keyName) {
    if (!publicKey) {
        throw new Error("must provide one of `keyName` or `publicKey`");
    }
    const key = new aws.ec2.KeyPair("key", { publicKey });
    keyName = key.keyName;
}

const secgrp = new aws.ec2.SecurityGroup("secgrp", {
    description: "Foo",
    vpcId: vpc.id,
    ingress: [
        { protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "icmp", fromPort: 8, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
    ],
    egress: [
        { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
    ],
});

//Get the AMI
const amiId = aws.ec2.getAmi({
    owners: ["amazon"],
    mostRecent: true,
    filters: [{
        name: "description",
        values: ["Amazon Linux 2 *"],
    }],
}, { async: true }).then(ami => ami.id);


const webALB = new awsx.lb.ApplicationLoadBalancer("web-alb", {
    vpc: vpc
})

const albTG = webALB.createTargetGroup("alb-tg",{
    protocol: "HTTP",
    targetType: "instance",
})

const albListener = albTG.createListener("alb-listener", {
    protocol: "HTTP"
})


//Launch Configuration
const asConf = new aws.ec2.LaunchConfiguration("asConf", {
    namePrefix: "lc-example-",
    imageId: amiId,
    instanceType: "t2.micro",
    securityGroups:  [secgrp.id],
    associatePublicIpAddress: true,
    keyName: keyName,


});

// Autoscaling group
const bar = new aws.autoscaling.Group("bar", {
    launchConfiguration: asConf.name,
    vpcZoneIdentifiers: vpc.publicSubnetIds,
    tags: [
        {
            key: "Name",
            value: "web-server",
            propagateAtLaunch: true,
        },
    ],
    minSize: 1,
    maxSize: 2,
});

// Create a new ALB Target Group attachment
new aws.autoscaling.Attachment("asg-attachment", {
    albTargetGroupArn: albTG.targetGroup.arn,
    autoscalingGroupName: bar.name,
})

export const webURL = albListener.endpoint.hostname